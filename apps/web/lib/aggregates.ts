// Period aggregates derived from raw samples via trapezoidal integration.
// Same calculation regardless of period — accuracy is "good enough" for a
// dashboard given 60s sampling.
//
// Sign convention:
// - Shelly total_w: positive = grid → home (import), negative = home → grid (export)
// - solar.total: always positive
// - output.total: positive = battery+PV → Hoymiles → home
// - battery_flow_w (derived): pv - output. Positive = charging, negative = discharging.

import type { ShellyRow, MarstekRow, UserSettings } from "./queries";

export type PeriodAggregates = {
  pvProducedKwh: number;
  consumptionKwh: number;
  outputKwh: number;
  importKwh: number;
  exportKwh: number;
  batteryChargedKwh: number;       // total Wh charged (positive flow only)
  batteryDischargedKwh: number;    // total Wh discharged (negative flow only)
  selfConsumptionPct: number | null;   // (pv - export) / pv × 100
  autarkyPct: number | null;            // (consumption - import) / consumption × 100
  costAvoidedEur: number;
  feedInRevenueEur: number;
  costImportedEur: number;
  // Convenience: total cost without the system (everything from grid)
  costWithoutSystemEur: number;
};

type Sample = { ts: string };

function integrate<T extends Sample>(
  rows: T[],
  getter: (r: T) => number | null | undefined,
) {
  let pos = 0;
  let neg = 0;
  let total = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const dt =
      (new Date(cur.ts).getTime() - new Date(prev.ts).getTime()) / 1000;
    if (dt <= 0 || dt > 600) continue;  // gap → skip
    const a = getter(prev) ?? 0;
    const b = getter(cur) ?? 0;
    const wh = (((a + b) / 2) * dt) / 3600;
    total += wh;
    if (wh > 0) pos += wh;
    else neg += -wh;
  }
  return { total, pos, neg };
}

export function computePeriodAggregates(
  shelly: ShellyRow[],
  marstek: MarstekRow[],
  settings: UserSettings,
): PeriodAggregates {
  const saldoI = integrate(shelly, (r) => r.total_w);
  const importWh = saldoI.pos;
  const exportWh = saldoI.neg;

  const pvI = integrate(marstek, (r) => r.pv_total_w);
  const outputI = integrate(marstek, (r) => r.output_total_w);

  // Battery flow integrated separately so we report charged/discharged as
  // independent positive numbers (rather than netted). Lossless model.
  const batteryI = integrate(marstek, (r) =>
    (r.pv_total_w ?? 0) - (r.output_total_w ?? 0),
  );

  // Consumption = output + saldo (signed). saldoI.total = pos - neg = signed.
  const consumptionWh = outputI.pos + saldoI.total;

  const pvWh = pvI.pos;
  const selfConsumptionPct =
    pvWh > 0
      ? clamp(((pvWh - exportWh) / pvWh) * 100, 0, 100)
      : null;
  const autarkyPct =
    consumptionWh > 0
      ? clamp(((consumptionWh - importWh) / consumptionWh) * 100, 0, 100)
      : null;

  const energyCt = Number(settings.energy_price_ct_kwh);
  const feedInCt = Number(settings.feed_in_ct_kwh);
  const selfUsedKwh = Math.max(0, (pvWh - exportWh)) / 1000;

  return {
    pvProducedKwh: pvWh / 1000,
    consumptionKwh: consumptionWh / 1000,
    outputKwh: outputI.pos / 1000,
    importKwh: importWh / 1000,
    exportKwh: exportWh / 1000,
    batteryChargedKwh: batteryI.pos / 1000,
    batteryDischargedKwh: batteryI.neg / 1000,
    selfConsumptionPct,
    autarkyPct,
    costAvoidedEur: selfUsedKwh * (energyCt / 100),
    feedInRevenueEur: (exportWh / 1000) * (feedInCt / 100),
    costImportedEur: (importWh / 1000) * (energyCt / 100),
    costWithoutSystemEur: ((consumptionWh / 1000) * (energyCt / 100)),
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Live ("now") computation ─────────────────────────────────────────────

export type LiveState = {
  pvW: number | null;
  outputW: number | null;
  saldoW: number | null;
  consumptionW: number | null;
  batteryFlowW: number | null;       // + charging, − discharging
  socPct: number | null;
  storedWh: number | null;
  // Edge magnitudes for the flow diagram
  pvToBatteryW: number;
  pvToHomeW: number;
  batteryToHomeW: number;
  homeToGridW: number;
  gridToHomeW: number;
  // Diagnostics
  scene: string | null;
  packTempC: { min: number | null; max: number | null };
  alarms: { charge: boolean; discharge: boolean };
};

const BATTERY_CAPACITY_WH = 2240;  // Marstek B2500-D nominal

export function deriveLive(
  latestShelly: ShellyRow | null,
  latestMarstek: MarstekRow | null,
  rawMarstek: Record<string, unknown> | null,
): LiveState {
  const pvW = latestMarstek?.pv_total_w ?? null;
  const outputW = latestMarstek?.output_total_w ?? null;
  const saldoW = latestShelly?.total_w ?? null;

  const consumptionW =
    outputW != null && saldoW != null ? outputW + saldoW : null;
  const batteryFlowW =
    pvW != null && outputW != null ? pvW - outputW : null;

  const socPct = latestMarstek?.battery_soc_pct ?? null;

  // Try to read live stored Wh from raw.values.kn (string→number).
  // Fallback: SOC% × capacity.
  let storedWh: number | null = null;
  const knRaw =
    (rawMarstek as { values?: Record<string, string> } | null)?.values?.kn;
  if (knRaw != null && /^\d+$/.test(String(knRaw))) {
    storedWh = Number(knRaw);
  } else if (socPct != null) {
    storedWh = (socPct / 100) * BATTERY_CAPACITY_WH;
  }

  const pv = pvW ?? 0;
  const out = outputW ?? 0;
  const sal = saldoW ?? 0;
  const pvToBattery = Math.max(0, pv - out);
  const pvToHome = Math.min(pv, out);
  const batteryToHome = Math.max(0, out - pv);
  const homeToGrid = Math.max(0, -sal);
  const gridToHome = Math.max(0, sal);

  return {
    pvW,
    outputW,
    saldoW,
    consumptionW,
    batteryFlowW,
    socPct,
    storedWh,
    pvToBatteryW: pvToBattery,
    pvToHomeW: pvToHome,
    batteryToHomeW: batteryToHome,
    homeToGridW: homeToGrid,
    gridToHomeW: gridToHome,
    scene:
      (rawMarstek as { scene?: string } | null)?.scene ?? null,
    packTempC: {
      min: (latestMarstek as MarstekRow | null)?.["temp_min_c" as keyof MarstekRow] as number | null ?? null,
      max: (latestMarstek as MarstekRow | null)?.["temp_max_c" as keyof MarstekRow] as number | null ?? null,
    },
    alarms: {
      charge:
        ((latestMarstek as MarstekRow | null)?.["charge_alarm" as keyof MarstekRow] as
          | boolean
          | null) ?? false,
      discharge:
        ((latestMarstek as MarstekRow | null)?.["discharge_alarm" as keyof MarstekRow] as
          | boolean
          | null) ?? false,
    },
  };
}

export const BATTERY_CAPACITY_WH_CONST = BATTERY_CAPACITY_WH;
