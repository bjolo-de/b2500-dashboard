// Vercel Cron handler — runs every 5 minutes (see vercel.json).
//
// Logic: pull all heartbeats, classify each component's severity using the
// same age thresholds as the dashboard. Compare to last_alerted_severity.
// On state change, send a single ntfy.sh push and update the row.
//
// Authentication: Vercel signs cron requests with a CRON_SECRET. Anyone
// could trigger this endpoint manually — worst case costs us a few extra
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

function transitionMessage(spec: ComponentSpec, prev: Severity | null, next: Severity): string | null {
  if (prev === next) return null;
  if (next === "down") {
    const hint = ACTION_HINTS[spec.key];
    return `${spec.label} ist offline${hint ? `\n${hint}` : ""}`;
  }
  if (next === "warn") return `${spec.label} meldet sich verzögert`;
  if (next === "ok" && prev != null && prev !== "ok") return `${spec.label} ist wieder online`;
  return null;
}

function severityToTags(s: Severity): string {
  switch (s) {
    case "down": return "rotating_light,red_circle";
    case "warn": return "warning,yellow_circle";
    case "ok":   return "white_check_mark,green_circle";
  }
}

function priorityFor(s: Severity): string {
  switch (s) {
    case "down": return "high";
    case "warn": return "default";
    case "ok":   return "low";
  }
}

async function ntfyPush(topic: string, title: string, message: string, severity: Severity) {
  // Deliberately NO ntfy "Email" header here: ntfy.sh rejects anonymous
  // email sending (HTTP 400), and since header and push share one request,
  // a configured email would kill the push too. Email goes out separately
  // via Resend below — the two channels must never share a failure mode.
  return fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: {
      "Title": title,
      "Tags": severityToTags(severity),
      "Priority": priorityFor(severity),
    },
    body: message,
  });
}

// Second delivery channel: direct email via Resend's REST API. iOS/APNs
// delivery for the ntfy app proved unreliable in both outages — mail
// banners via the native Mail app are the dependable fallback. Address
// comes from user_settings.alert_email (tariff sheet); needs
// RESEND_API_KEY in the Vercel env (free tier, no domain required).
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

  const ntfyTopic = settingsResult.data?.ntfy_topic ?? null;
  const alertEmail: string | null =
    settingsResult.data?.alert_email ?? process.env.ALERT_EMAIL ?? null;

  // Channel test hook: /api/health-check?test=push|email sends a test
  // message on that channel and reports the raw outcome — without touching
  // alert state. Lets us verify delivery end-to-end after config changes.
  const testMode = new URL(req.url).searchParams.get("test");
  if (testMode === "push" || testMode === "email") {
    try {
      if (testMode === "push") {
        if (!ntfyTopic) throw new Error("no ntfy topic configured");
        const r = await ntfyPush(ntfyTopic, "B2500 Energy", "Kanal-Test: ntfy-Push", "ok");
        if (!r.ok) throw new Error(`ntfy ${r.status}`);
      } else {
        if (!alertEmail) throw new Error("no alert_email configured");
        await sendAlertEmail(alertEmail, "B2500 Energy: Kanal-Test", "Kanal-Test: E-Mail-Zustellung funktioniert.");
      }
      return NextResponse.json({ test: testMode, sent: true });
    } catch (e) {
      return NextResponse.json(
        { test: testMode, sent: false, reason: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
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

  const pushResults: Array<{ component: string; channel: string; sent: boolean; reason?: string }> = [];

  // Push and email are attempted independently per transition — a broken
  // channel must never take the other one down with it.
  for (const t of transitions) {
    if (ntfyTopic) {
      try {
        const r = await ntfyPush(ntfyTopic, "B2500 Energy", t.msg, t.current);
        if (!r.ok) throw new Error(`ntfy ${r.status}`);
        pushResults.push({ component: t.spec.key, channel: "ntfy", sent: true });
      } catch (e) {
        pushResults.push({
          component: t.spec.key,
          channel: "ntfy",
          sent: false,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      pushResults.push({ component: t.spec.key, channel: "ntfy", sent: false, reason: "no ntfy topic configured" });
    }
    if (alertEmail) {
      try {
        await sendAlertEmail(alertEmail, `B2500 Energy: ${t.spec.label} ${t.current === "ok" ? "wieder online" : t.current}`, t.msg);
        pushResults.push({ component: t.spec.key, channel: "email", sent: true });
      } catch (e) {
        pushResults.push({
          component: t.spec.key,
          channel: "email",
          sent: false,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // Update last_alerted_severity for components whose state changed —
  // even if push failed, so we don't loop on retries.
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
    ntfyTopic: ntfyTopic ?? null,
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
    pushed: pushResults,
  });
}
