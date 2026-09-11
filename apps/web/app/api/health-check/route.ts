// Vercel/GitHub Cron handler — runs every few minutes (see vercel.json and
// .github/workflows/health-cron.yml).
//
// Logic: pull all heartbeats, classify each component's severity using the
// same age thresholds as the dashboard. Compare to last_alerted_severity.
// On a down- or recovery-transition, email the user and update the row.
//
// Notification channel is email via Resend. ntfy was removed after its iOS
// push proved undeliverable across two months of troubleshooting; email has
// delivered reliably. `warn` transitions are deliberately NOT notified (brief
// WLAN hiccups flap ok↔warn several times a day) — only `down` and recovery
// from down reach the inbox. The dashboard still shows warn via lib/
// system-health.ts, which classifies independently of this route.
//
// Authentication: Vercel signs cron requests with a CRON_SECRET. Anyone
// could trigger this endpoint manually — worst case costs a few extra
// notifications, no data exposure.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Severity = "ok" | "warn" | "down";

type ComponentSpec = {
  key: string;
  label: string;
  warnAfterSec: number;
  downAfterSec: number;
};

const COMPONENTS: ComponentSpec[] = [
  { key: "shelly_script", label: "Shelly",          warnAfterSec: 8 * 60,  downAfterSec: 20 * 60 },
  { key: "forwarder",     label: "Marstek-MQTT",    warnAfterSec: 5 * 60,  downAfterSec: 15 * 60 },
  { key: "pico_bridge",   label: "Pico-Bridge",     warnAfterSec: 8 * 60,  downAfterSec: 20 * 60 },
  // Derived from the newest marstek_readings row (upserted below): catches
  // the case where the forwarder process is alive but the B2500 itself
  // stopped publishing — during the July outage the forwarder stayed green
  // while no battery telemetry arrived for seven days.
  { key: "marstek_data",  label: "B2500-Daten",     warnAfterSec: 10 * 60, downAfterSec: 30 * 60 },
];

function classify(ageSec: number, spec: ComponentSpec): Severity {
  if (ageSec > spec.downAfterSec) return "down";
  if (ageSec > spec.warnAfterSec) return "warn";
  return "ok";
}

// What the user can actually DO, per component — appended to down alerts so
// the notification itself is the runbook (see docs/runbook.md for the long
// form). Learned in the August outage: "X ist offline" alone leaves the
// reader with a red pill and no plan.
const ACTION_HINTS: Record<string, string> = {
  shelly_script:
    "→ Shelly-Cloud-App öffnen und Gerät neu starten; wenn offline: Router/WLAN prüfen.",
  forwarder:
    "→ SSH auf Oracle-VM: docker restart b2500-stack.",
  pico_bridge:
    "→ Pico am Router-USB aus- und wieder einstecken.",
  marstek_data:
    "→ Marstek-App in der Nähe des Speichers öffnen — Bluetooth weckt das Gerät. Tritt v. a. nach Tiefentladung (SOC ~0 %) auf.",
};

// Returns the notification body, or null if this transition should NOT
// notify. warn is intentionally silent — only down and recovery-from-down
// reach the user, so brief ok↔warn flapping never spams the inbox. Because
// warn never returns a message, it never becomes a recorded transition and
// last_alerted_severity stays on the ok/down axis: an ok→warn→ok hiccup
// produces zero mails, while down→warn→ok yields exactly one "wieder online".
function transitionMessage(spec: ComponentSpec, prev: Severity | null, next: Severity): string | null {
  if (prev === next) return null;
  if (next === "down") {
    const hint = ACTION_HINTS[spec.key];
    return `${spec.label} ist offline${hint ? `\n${hint}` : ""}`;
  }
  if (next === "ok" && prev != null && prev !== "ok") return `${spec.label} ist wieder online`;
  return null;
}

// Delivery via Resend's REST API. iOS Mail banners are reliable where the
// ntfy app's APNs push was not. Address comes from user_settings.alert_email
// (editable in the dashboard's tariff sheet), env ALERT_EMAIL as fallback.
// Needs RESEND_API_KEY in the Vercel env (free tier, onboarding@resend.dev
// sender, no domain setup).
async function sendAlertEmail(to: string, subject: string, message: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "B2500 Energy <onboarding@resend.dev>",
      to: [to],
      subject,
      text: message,
    }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text()}`);
}

type ChannelResult = { channel: string; sent: boolean; reason?: string };

// Fan a transition out to every configured channel, each isolated so one
// broken channel can't suppress another. Adding a push channel (Pushover,
// Telegram, …) is a second block here — nothing else changes.
async function notify(
  alertEmail: string | null,
  subject: string,
  message: string,
): Promise<ChannelResult[]> {
  const results: ChannelResult[] = [];
  if (alertEmail) {
    try {
      await sendAlertEmail(alertEmail, subject, message);
      results.push({ channel: "email", sent: true });
    } catch (e) {
      results.push({ channel: "email", sent: false, reason: e instanceof Error ? e.message : String(e) });
    }
  } else {
    results.push({ channel: "email", sent: false, reason: "no alert_email configured" });
  }
  return results;
}

export async function GET(req: Request) {
  // Optional Vercel cron auth. If CRON_SECRET is set, require it.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  if (!url || !key) {
    return NextResponse.json({ error: "supabase config missing" }, { status: 500 });
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [heartbeatsResult, settingsResult, marstekResult] = await Promise.all([
    supabase
      .from("system_heartbeat")
      .select("component, last_seen, last_alerted_severity"),
    // select("*") — tolerant to alert_email not existing until migration
    // 0005 is applied; the field then simply reads as undefined.
    supabase.from("user_settings").select("*").eq("id", 1).single(),
    supabase
      .from("marstek_readings")
      .select("ts")
      .order("ts", { ascending: false })
      .limit(1),
  ]);

  if (heartbeatsResult.error) {
    return NextResponse.json({ error: heartbeatsResult.error.message }, { status: 500 });
  }

  const alertEmail: string | null =
    settingsResult.data?.alert_email ?? process.env.ALERT_EMAIL ?? null;

  // Channel test hook: /api/health-check?test=email sends a test message and
  // reports the raw outcome — without touching alert state. Verifies delivery
  // end-to-end after any config change.
  const testMode = new URL(req.url).searchParams.get("test");
  if (testMode === "email") {
    const results = await notify(alertEmail, "B2500 Energy: Kanal-Test", "Kanal-Test: E-Mail-Zustellung funktioniert.");
    const ok = results.some((r) => r.channel === "email" && r.sent);
    return NextResponse.json({ test: "email", results }, { status: ok ? 200 : 502 });
  }

  const heartbeats = heartbeatsResult.data ?? [];
  const now = Date.now();

  // Persist the derived marstek_data "heartbeat" (last_seen = newest reading)
  // so both this classification and the dashboard's status row see it. The
  // upsert only touches last_seen — alert-state columns stay intact.
  const marstekTs: string | null = marstekResult.data?.[0]?.ts ?? null;
  if (marstekTs) {
    await supabase
      .from("system_heartbeat")
      .upsert({ component: "marstek_data", last_seen: marstekTs }, { onConflict: "component" });
    const existing = heartbeats.find((h) => h.component === "marstek_data");
    if (existing) {
      existing.last_seen = marstekTs;
    } else {
      heartbeats.push({
        component: "marstek_data",
        last_seen: marstekTs,
        last_alerted_severity: null,
      });
    }
  }

  type Item = { spec: ComponentSpec; current: Severity; prev: Severity | null; lastSeen: string | null };
  const items: Item[] = COMPONENTS.map((spec) => {
    const hb = heartbeats.find((h) => h.component === spec.key);
    if (!hb) {
      return { spec, current: "down", prev: null, lastSeen: null };
    }
    const ageSec = Math.round((now - new Date(hb.last_seen).getTime()) / 1000);
    return {
      spec,
      current: classify(ageSec, spec),
      prev: (hb.last_alerted_severity as Severity | null) ?? null,
      lastSeen: hb.last_seen,
    };
  });

  const transitions = items
    .map((it) => ({ ...it, msg: transitionMessage(it.spec, it.prev, it.current) }))
    .filter((it): it is Item & { msg: string } => it.msg != null);

  const notified: Array<{ component: string; to: Severity } & { results: ChannelResult[] }> = [];
  for (const t of transitions) {
    const subject = `B2500 Energy: ${t.spec.label} ${t.current === "ok" ? "wieder online" : "offline"}`;
    const results = await notify(alertEmail, subject, t.msg);
    notified.push({ component: t.spec.key, to: t.current, results });
  }

  // Update last_alerted_severity for components whose state changed — even if
  // delivery failed, so we don't loop on retries.
  const updates = transitions.map((t) =>
    supabase
      .from("system_heartbeat")
      .update({
        last_alerted_severity: t.current,
        last_alerted_at: new Date().toISOString(),
      })
      .eq("component", t.spec.key),
  );
  await Promise.all(updates);

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    alertEmail: alertEmail ? "configured" : null,
    items: items.map((it) => ({
      component: it.spec.key,
      current: it.current,
      prev: it.prev,
      lastSeen: it.lastSeen,
    })),
    transitions: transitions.map((t) => ({
      component: t.spec.key,
      from: t.prev,
      to: t.current,
      message: t.msg,
    })),
    notified,
  });
}
