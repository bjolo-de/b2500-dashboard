// Forwarder: subscribes to hm2mqtt's parsed B2500 telemetry, writes to Supabase.
//
// Topic shape from hm2mqtt: hm2mqtt/<deviceType>/device/<mac>/data
// Payload: JSON object matching the upstream types.ts schema.
// We project it into the marstek_readings columns.
//
// Robustness:
// - On Supabase failure, queue up to QUEUE_MAX rows in memory and retry.
// - Heartbeat to Supabase every 60s so the dashboard sees the forwarder alive.
// - mqtt.js handles reconnects to HiveMQ automatically.

import mqtt from "mqtt";

const env = (k, fallback) => {
  const v = process.env[k];
  if (v === undefined && fallback === undefined) {
    console.error(`[fatal] missing env var ${k}`);
    process.exit(1);
  }
  return v ?? fallback;
};

const MQTT_URL = env("MQTT_URL");
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY = env("SUPABASE_SERVICE_KEY");
const TOPIC = env("MQTT_TOPIC", "hm2mqtt/+/device/+/data");
const QUEUE_MAX = Number(env("QUEUE_MAX", "300"));
const HEARTBEAT_MS = Number(env("HEARTBEAT_MS", "60000"));

// ─── Supabase REST helpers ────────────────────────────────────────────────

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function postJson(path, body) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
    headers: supabaseHeaders,
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
  }
}

async function upsertHeartbeat(component, details = null) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/system_heartbeat?on_conflict=component`,
    {
      method: "POST",
      headers: { ...supabaseHeaders, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([
        { component, last_seen: new Date().toISOString(), details },
      ]),
    },
  );
}

// ─── Payload projection ───────────────────────────────────────────────────
// Schema reference: tomquist/hm2mqtt src/types.ts. We tolerate missing keys
// (older firmware, partial polls) by mapping to null.

function project(payload) {
  const dailyStats = payload.dailyStats ?? {};
  const solar = payload.solarPower ?? {};
  const out = payload.outputPower ?? {};
  const temp = payload.temperature ?? {};
  return {
    ts: new Date().toISOString(),
    battery_soc_pct: payload.batteryPercentage ?? null,
    pv_input1_w: solar.input1 ?? null,
    pv_input2_w: solar.input2 ?? null,
    pv_total_w: solar.total ?? null,
    output1_w: out.output1 ?? null,
    output2_w: out.output2 ?? null,
    output_total_w: out.total ?? null,
    daily_pv_charge_wh: dailyStats.photovoltaicChargingPower ?? null,
    daily_battery_charge_wh: dailyStats.batteryChargingPower ?? null,
    daily_battery_discharge_wh: dailyStats.batteryDischargePower ?? null,
    temp_min_c: temp.min ?? null,
    temp_max_c: temp.max ?? null,
    charge_alarm: temp.chargingAlarm ?? null,
    discharge_alarm: temp.dischargeAlarm ?? null,
    raw: payload,
  };
}

// ─── In-memory retry queue ────────────────────────────────────────────────

const queue = [];
let flushing = false;

async function flushQueue() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      const batch = queue.splice(0, 50);
      await postJson("/rest/v1/marstek_readings", batch);
    }
  } catch (e) {
    console.warn(`[supabase] flush failed, will retry: ${e.message}`);
  } finally {
    flushing = false;
  }
}

function enqueue(row) {
  queue.push(row);
  if (queue.length > QUEUE_MAX) {
    const dropped = queue.length - QUEUE_MAX;
    queue.splice(0, dropped);
    console.warn(`[queue] capped, dropped ${dropped} oldest rows`);
  }
  flushQueue();
}

// ─── MQTT ─────────────────────────────────────────────────────────────────

console.log(`[mqtt] connecting to ${MQTT_URL.replace(/:[^@]+@/, ":***@")}`);

const client = mqtt.connect(MQTT_URL, {
  reconnectPeriod: 5000,
  connectTimeout: 30_000,
  clientId: `b2500-forwarder-${Math.random().toString(16).slice(2, 10)}`,
});

client.on("connect", () => {
  console.log(`[mqtt] connected, subscribing to ${TOPIC}`);
  client.subscribe(TOPIC, { qos: 1 }, (err) => {
    if (err) console.error(`[mqtt] subscribe failed: ${err.message}`);
  });
});

client.on("reconnect", () => console.log("[mqtt] reconnecting…"));
client.on("error", (err) => console.error(`[mqtt] error: ${err.message}`));
client.on("close", () => console.log("[mqtt] connection closed"));

client.on("message", (topic, payload) => {
  let parsed;
  try {
    parsed = JSON.parse(payload.toString());
  } catch (e) {
    console.warn(`[mqtt] non-json message on ${topic}: ${e.message}`);
    return;
  }
  const row = project(parsed);
  enqueue(row);
});

// Periodic flush (covers the case where last enqueue's flush failed silently)
setInterval(flushQueue, 30_000);

// Heartbeat
setInterval(async () => {
  try {
    await upsertHeartbeat("forwarder", {
      queue_depth: queue.length,
      mqtt_connected: client.connected,
    });
  } catch (e) {
    console.warn(`[heartbeat] failed: ${e.message}`);
  }
}, HEARTBEAT_MS);

// Graceful shutdown
const shutdown = (sig) => {
  console.log(`[lifecycle] ${sig}, shutting down`);
  client.end(true, () => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
