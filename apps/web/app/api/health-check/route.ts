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

function transitionMessage(label: string, prev: Severity | null, next: Severity): string | null {
  if (prev === next) return null;
  if (next === "down") return `${label} ist offline`;
  if (next === "warn") return `${label} meldet sich verzögert`;
  if (next === "ok" && prev != null && prev !== "ok") return `${label} ist wieder online`;
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
  const headers: Record<string, string> = {
    "Title": title,
    "Tags": severityToTags(severity),
    "Priority": priorityFor(severity),
  };
  // Second delivery channel: ntfy.sh forwards the same message as an email.
  // iOS APNs delivery for the ntfy app proved unreliable (messages reached
  // ntfy.sh during the July outage but never banner'd on the phone) — mail
  // banners via the native Mail app are the dependable fallback. Set
  // ALERT_EMAIL in the Vercel project env. ntfy.sh caps free-tier emails
  // at a handful per day; transitions are rare, so that's plenty.
  const email = process.env.ALERT_EMAIL;
  if (email) headers["Email"] = email;
  return fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers,
    body: message,
  });
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
    supabase.from("user_settings").select("ntfy_topic").eq("id", 1).single(),
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
    .map((it) => ({ ...it, msg: transitionMessage(it.spec.label, it.prev, it.current) }))
    .filter((it): it is Item & { msg: string } => it.msg != null);

  const pushResults: Array<{ component: string; sent: boolean; reason?: string }> = [];

  for (const t of transitions) {
    if (!ntfyTopic) {
      pushResults.push({ component: t.spec.key, sent: false, reason: "no ntfy topic configured" });
      continue;
    }
    try {
      const r = await ntfyPush(ntfyTopic, "B2500 Energy", t.msg, t.current);
      if (!r.ok) throw new Error(`ntfy ${r.status}`);
      pushResults.push({ component: t.spec.key, sent: true });
    } catch (e) {
      pushResults.push({
        component: t.spec.key,
        sent: false,
        reason: e instanceof Error ? e.message : String(e),
      });
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
