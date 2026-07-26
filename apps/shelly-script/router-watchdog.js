// Router watchdog for a Shelly Plug S (Gen2/Gen3) that powers the router.
//
// WHY: When the router hangs (July 2026 outage: WLAN clients dropped one by
// one, then a week of dead telemetry), NO remote path can help — the remote
// path IS the router. The only fix that works unattended is local:
// a plug that notices dead internet and power-cycles the router itself.
//
// LOGIC: Every CHECK_INTERVAL_S the script HTTP-GETs a connectivity URL.
// After FAILS_BEFORE_CYCLE consecutive failures it switches the relay off
// for OFF_TIME_S, then back on, then waits BOOT_GRACE_S for the router to
// boot before checking again. COOLDOWN_S guards against reboot loops when
// the outage is upstream (ISP down): at most one cycle per cooldown window.
//
// Setup:
//   1. Plug the router's power supply into the Shelly Plug S.
//   2. Plug web UI → Settings → "Default switch state" → ON  (critical:
//      after a power blip the router must come back without intervention).
//   3. Scripts → Add → paste this file → Save → Enable "Run on startup" → Start.
//
// The script needs no Supabase/cloud config — it is fully self-contained.

// ─── CONFIG ───────────────────────────────────────────────────────────────

const CHECK_INTERVAL_S = 60;      // connectivity probe cadence
const FAILS_BEFORE_CYCLE = 5;     // consecutive failures → power-cycle (5 min)
const OFF_TIME_S = 10;            // relay off-time during the cycle
const BOOT_GRACE_S = 300;         // pause checks while the router boots
const COOLDOWN_S = 1800;          // min. 30 min between two power-cycles
const SWITCH_ID = 0;

// Two independent probe targets; alternating between them avoids declaring
// the internet dead because one endpoint has a bad day. Plain HTTP + IP-
// independent hosts — DNS dying with the router is itself a valid failure.
const PROBE_URLS = [
  "http://connectivitycheck.gstatic.com/generate_204",
  "http://captive.apple.com/hotspot-detect.html",
];

// ─── STATE ────────────────────────────────────────────────────────────────

let failCount = 0;
let probeIdx = 0;
let graceUntilUptime = 0;         // uptime seconds until which checks pause
let lastCycleUptime = -COOLDOWN_S; // allow a cycle right after boot if needed
let uptimeS = 0;                  // driven by our own timer

function log(msg) {
  console.log("[watchdog] " + msg);
}

function powerCycle() {
  log("internet dead for " + (failCount * CHECK_INTERVAL_S) + "s -> power-cycling router");
  lastCycleUptime = uptimeS;
  failCount = 0;
  graceUntilUptime = uptimeS + OFF_TIME_S + BOOT_GRACE_S;
  Shelly.call("Switch.Set", { id: SWITCH_ID, on: false }, function () {
    Timer.set(OFF_TIME_S * 1000, false, function () {
      Shelly.call("Switch.Set", { id: SWITCH_ID, on: true }, function () {
        log("router power restored, grace " + BOOT_GRACE_S + "s");
      });
    });
  });
}

function probe() {
  uptimeS += CHECK_INTERVAL_S;
  if (uptimeS < graceUntilUptime) return;

  const url = PROBE_URLS[probeIdx];
  probeIdx = (probeIdx + 1) % PROBE_URLS.length;

  Shelly.call(
    "HTTP.GET",
    { url: url, timeout: 10 },
    function (result, errCode) {
      const ok = errCode === 0 && result && result.code >= 200 && result.code < 400;
      if (ok) {
        if (failCount > 0) log("internet back after " + failCount + " failed probes");
        failCount = 0;
        return;
      }
      failCount += 1;
      log("probe failed (" + failCount + "/" + FAILS_BEFORE_CYCLE + "): " + url);
      if (failCount < FAILS_BEFORE_CYCLE) return;
      if (uptimeS - lastCycleUptime < COOLDOWN_S) {
        log("in cooldown — outage is likely upstream (ISP), waiting");
        return;
      }
      powerCycle();
    },
  );
}

log("armed: probe every " + CHECK_INTERVAL_S + "s, cycle after " + FAILS_BEFORE_CYCLE + " failures");
Timer.set(CHECK_INTERVAL_S * 1000, true, probe);
