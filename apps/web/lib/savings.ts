// Cost-saved-today calculation.
// Logic: each shelly_readings row is a sample of the saldo (W). For each
// row we know the time delta to the previous row. Multiply average power
// over the delta to get Wh; sum positive (avoided imports) and negative
// (exports) separately, apply tariff and feed-in rate.

import type { ShellyRow, MarstekRow, UserSettings } from "./queries";

export type DailyTotals = {
  importedKwh: number;     // grid → house
  exportedKwh: number;     // house → grid
  pvKwh: number | null;    // PV produced today (from marstek dailyStats)
  batteryDischargeKwh: number | null;
  batteryChargeKwh: number | null;
  costAvoidedEur: number;  // value of self-consumed PV
  feedInRevenueEur: number;
};

export function computeDailyTotals(
  shelly: ShellyRow[],
  latestMarstek: MarstekRow | null,
  settings: UserSettings,
): DailyTotals {
  let importedWh = 0;
  let exportedWh = 0;

  for (let i = 1; i < shelly.length; i++) {
    const prev = shelly[i - 1];
    const cur = shelly[i];
    const dtSec =
      (new Date(cur.ts).getTime() - new Date(prev.ts).getTime()) / 1000;
    if (dtSec <= 0 || dtSec > 600) continue;  // gap → skip
    const avgW = (prev.total_w + cur.total_w) / 2;
    const energyWh = (avgW * dtSec) / 3600;
    if (energyWh > 0) importedWh += energyWh;
    else exportedWh += -energyWh;
  }

  const importedKwh = importedWh / 1000;
  const exportedKwh = exportedWh / 1000;

  // PV self-consumption proxy: PV produced today minus what went to grid
  // (export). Battery losses ignored here — close enough for a dashboard.
  const pvKwh = latestMarstek?.daily_pv_charge_wh
    ? latestMarstek.daily_pv_charge_wh / 1000
    : null;
  const selfConsumedPvKwh = pvKwh != null ? Math.max(0, pvKwh - exportedKwh) : 0;
  const costAvoidedEur =
    selfConsumedPvKwh * (Number(settings.energy_price_ct_kwh) / 100);
  const feedInRevenueEur =
    exportedKwh * (Number(settings.feed_in_ct_kwh) / 100);

  return {
    importedKwh,
    exportedKwh,
    pvKwh,
    batteryDischargeKwh: latestMarstek?.daily_battery_discharge_wh
      ? latestMarstek.daily_battery_discharge_wh / 1000
      : null,
    batteryChargeKwh: latestMarstek?.daily_battery_charge_wh
      ? latestMarstek.daily_battery_charge_wh / 1000
      : null,
    costAvoidedEur,
    feedInRevenueEur,
  };
}

export function isComponentStale(lastSeenIso: string, maxStaleMs = 5 * 60_000) {
  return Date.now() - new Date(lastSeenIso).getTime() > maxStaleMs;
}
