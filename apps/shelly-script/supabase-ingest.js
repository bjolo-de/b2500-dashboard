// Shelly 3EM Gen3 → Supabase ingest.
//
// Runs on the meter itself: every INTERVAL_S seconds it samples EM.GetStatus
// and POSTs a row to Supabase. Also writes a heartbeat every 5 min.
//
// Shelly Script (mJS) is callback-based — no async/await, no promises.
//
// Setup:
//   1. Shelly web UI → Scripts → Add → paste this file
//   2. Fill in the three constants below
//   3. Save → Enable on boot → Start

// ─── CONFIG ───────────────────────────────────────────────────────────────

const SUPABASE_URL = "";          // e.g. "https://xxx.supabase.co"
const SUPABASE_KEY = "";          // service_role key (Shelly is a trusted writer)
const INTERVAL_S = 60;            // sample cadence

// ─── CONSTANTS ────────────────────────────────────────────────────────────

const READINGS_ENDPOINT = SUPABASE_URL + "/rest/v1/shelly_readings";
const HEARTBEAT_ENDPOINT = SUPABASE_URL + "/rest/v1/system_heartbeat?on_conflict=component";
const HEARTBEAT_EVERY = 5;        // every Nth tick → heartbeat (so 5 min @ 60s)
let tickCount = 0;

const baseHeaders = {
  "apikey": SUPABASE_KEY,
  "Authorization": "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json",
  "Prefer": "return=minimal",
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function postJson(url, body, extraHeaders, cb) {
  const headers = Object.assign({}, baseHeaders, extraHeaders || {});
  Shelly.call(
    "HTTP.Request",
    {
      method: "POST",
      url: url,
      headers: headers,
      body: JSON.stringify(body),
      timeout: 10,
    },
    function (result, errCode, errMsg) {
      if (errCode !== 0) {
        console.log("[supabase] error " + errCode + ": " + errMsg);
      } else if (result && result.code >= 300) {
        console.log("[supabase] HTTP " + result.code + ": " + (result.body || ""));
      }
      if (cb) cb(errCode, result);
    },
  );
}

// ─── Sampling ─────────────────────────────────────────────────────────────

function sample() {
  Shelly.call("EM.GetStatus", { id: 0 }, function (status, errCode, errMsg) {
    if (errCode !== 0) {
      console.log("[em] error " + errCode + ": " + errMsg);
      return;
    }

    const row = {
      ts: new Date().toISOString(),
      total_w: status.total_act_power,
      a_w: status.a_act_power,
      b_w: status.b_act_power,
      c_w: status.c_act_power,
      raw: {
        a_voltage: status.a_voltage,
        b_voltage: status.b_voltage,
        c_voltage: status.c_voltage,
        a_current: status.a_current,
        b_current: status.b_current,
        c_current: status.c_current,
        total_current: status.total_current,
        a_pf: status.a_pf,
        b_pf: status.b_pf,
        c_pf: status.c_pf,
      },
    };

    postJson(READINGS_ENDPOINT, [row]);

    tickCount += 1;
    if (tickCount % HEARTBEAT_EVERY === 0) {
      heartbeat(status);
    }
  });
}

function heartbeat(emStatus) {
  const row = [{
    component: "shelly_script",
    last_seen: new Date().toISOString(),
    details: {
      total_w: emStatus.total_act_power,
      uptime_s: Shelly.getDeviceInfo ? null : null, // best-effort, not always available
    },
  }];
  postJson(HEARTBEAT_ENDPOINT, row, { "Prefer": "resolution=merge-duplicates" });
}

// ─── Boot ─────────────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log("[fatal] SUPABASE_URL and SUPABASE_KEY must be set in the script");
} else {
  console.log("[boot] sampling every " + INTERVAL_S + "s → " + SUPABASE_URL);
  // First sample fires immediately so initial state is visible without
  // waiting INTERVAL_S; subsequent samples are on the timer.
  sample();
  Timer.set(INTERVAL_S * 1000, true, sample);
}
