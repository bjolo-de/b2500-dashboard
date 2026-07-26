// Classify each component's health based on heartbeat freshness, plus a
// human-readable hint that helps the user decide if action is needed.

import type { Heartbeat } from "./queries";

export type Severity = "ok" | "warn" | "down";

export type ComponentHealth = {
  key: string;
  label: string;
  severity: Severity;
  hint: string;
  lastSeen: string | null;
  ageSec: number | null;
};

const COMPONENTS: Array<{
  key: string;
  label: string;
  warnAfterSec: number;
  downAfterSec: number;
  expectedIntervalSec: number;
  downHint: string;
  warnHint: string;
}> = [
  {
    key: "shelly_script",
    label: "Shelly",
    expectedIntervalSec: 300,            // shelly heartbeat every 5 min
    warnAfterSec: 8 * 60,
    downAfterSec: 20 * 60,
    warnHint: "Verspätung beim Senden — wahrscheinlich kurzer WLAN-Hänger",
    downHint:
      "Shelly antwortet nicht — prüfen, ob das Gerät online ist und das Script läuft (Web-UI → Scripts)",
  },
  {
    key: "forwarder",
    label: "Marstek-MQTT",
    expectedIntervalSec: 60,             // forwarder heartbeat every minute
    warnAfterSec: 5 * 60,
    downAfterSec: 15 * 60,
    warnHint: "Cloud-Forwarder antwortet verzögert",
    downHint:
      "MQTT-Stack auf Oracle erreicht Supabase nicht — Marstek-Daten ggf. unterbrochen",
  },
  {
    key: "pico_bridge",
    label: "Pico-Bridge",
    expectedIntervalSec: 300,            // pico heartbeat every 5 min
    warnAfterSec: 8 * 60,
    downAfterSec: 20 * 60,
    warnHint: "Pico meldet sich verzögert",
    downHint:
      "Pico nicht erreichbar — B2500 bekommt keine Zählerdaten und regelt nicht. Pico am Router-USB aus- und wieder einstecken.",
  },
  {
    // Derived component: freshness of the newest marstek_readings row,
    // upserted by the health-check cron. Covers the blind spot where the
    // forwarder process is alive (its own heartbeat green) but the B2500
    // itself stopped publishing — e.g. router/WLAN outage at the battery.
    key: "marstek_data",
    label: "B2500-Daten",
    expectedIntervalSec: 60,             // B2500 publishes ~1/min
    warnAfterSec: 10 * 60,
    downAfterSec: 30 * 60,
    warnHint: "B2500 sendet verzögert Telemetrie",
    downHint:
      "Keine Telemetrie vom B2500 — Speicher offline oder MQTT-Pfad unterbrochen (WLAN/Router am Speicher prüfen)",
  },
];

export function classifyHealth(heartbeats: Heartbeat[]): ComponentHealth[] {
  const now = Date.now();
  const byKey = new Map(heartbeats.map((h) => [h.component, h]));
  return COMPONENTS.map(({ key, label, warnAfterSec, downAfterSec, downHint, warnHint }) => {
    const hb = byKey.get(key);
    if (!hb) {
      return {
        key,
        label,
        severity: "down" as Severity,
        hint: "Noch keine Daten von dieser Komponente empfangen",
        lastSeen: null,
        ageSec: null,
      };
    }
    const ageSec = Math.round((now - new Date(hb.last_seen).getTime()) / 1000);
    let severity: Severity = "ok";
    let hint = "";
    if (ageSec > downAfterSec) {
      severity = "down";
      hint = downHint;
    } else if (ageSec > warnAfterSec) {
      severity = "warn";
      hint = warnHint;
    }
    return { key, label, severity, hint, lastSeen: hb.last_seen, ageSec };
  });
}

export function worstSeverity(items: ComponentHealth[]): Severity {
  if (items.some((i) => i.severity === "down")) return "down";
  if (items.some((i) => i.severity === "warn")) return "warn";
  return "ok";
}
