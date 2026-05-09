// Period aggregates derived from raw samples via trapezoidal integration.
// Sign convention:
// - Shelly total_w: positive = grid → home (import), negative = home → grid (export)
// - solar.total: always positive
// - output.total: positive = battery+PV → Hoymiles → home
// - battery_flow_w (derived): pv - output. Positive = charging, negative = discharging.

import type {
  DailyAggregateRow,
  MarstekRow,
  ShellyRow,
  UserSettings,
} from "./queries";

export type PeriodAggregates = {
  pvProducedKwh: number;
  consumptionKwh: number;
  outputKwh: number;
  importKwh: number;
  exportKwh: number;
  batteryChargedKwh: number;
  batteryDischargedKwh: number;
  // Directional flow totals (kWh) for the energy-flow diagram in aggregate mode
  pvToBatteryKwh: number;
  pvToHomeKwh: number;
  batteryToHomeKwh: number;
  homeToGridKwh: number;
  gridToHomeKwh: number;
  // SOC range over the period
  socMinPct: number | null;
  socMaxPct: number | null;
  socEndPct: number | null;
  // Battery activity
  /** Equivalent full cycles over the period: (charged + discharged) / (2 × capacity). */
  cyclesEquivalent: number;
  // KPIs
  selfConsumptionPct: number | null;
  autarkyPct: number | null;
  costAvoidedEur: number;
  feedInRevenueEur: number;
  costImportedEur: number;
  costWithoutSystemEur: number;
};

type Sample = { ts: string };

function integrate<T extends Sample>(rows: T[], getter: (r: T) => number | null | undefined) {
  let pos = 0, neg = 0, total = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const dt = (new Date(cur.ts).getTime() - new Date(prev.ts).getTime()) / 1000;
    if (dt <= 0 || dt > 600) continue;
    const a = getter(prev) ?? 0;
    const b = getter(cur) ?? 0;
    const wh = (((a + b) / 2) * dt) / 3600;
    total += wh;
    if (wh > 0) pos += wh;
    else neg += -wh;
  }
  return { total, pos, neg };
}

// Directional integration: trapezoidal sum of f(prev, cur) >= 0 only.
function integrateDir<T extends Sample>(
  rows: T[],
  getter: (r: T) => number,
): number {
  let total = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const dt = (new Date(cur.ts).getTime() - new Date(prev.ts).getTime()) / 1000;
    if (dt <= 0 || dt > 600) continue;
    const a = Math.max(0, getter(prev));
    const b = Math.max(0, getter(cur));
    total += (((a + b) / 2) * dt) / 3600;
  }
  return total;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
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

  // Directional flows over the period — these are the diagram's aggregate edges.
  const pvToBatteryWh = integrateDir(marstek, (r) =>
    (r.pv_total_w ?? 0) - (r.output_total_w ?? 0),
  );
  const batteryToHomeWh = integrateDir(marstek, (r) =>
    (r.output_total_w ?? 0) - (r.pv_total_w ?? 0),
  );
  const pvToHomeWh = integrateDir(marstek, (r) =>
    Math.min(r.pv_total_w ?? 0, r.output_total_w ?? 0),
  );

  // Consumption = output + signed saldo over period
  const consumptionWh = outputI.pos + saldoI.total;

  const pvWh = pvI.pos;
  const selfConsumptionPct =
    pvWh > 0 ? clamp(((pvWh - exportWh) / pvWh) * 100, 0, 100) : null;
  const autarkyPct =
    consumptionWh > 0
      ? clamp(((consumptionWh - importWh) / consumptionWh) * 100, 0, 100)
      : null;

  const energyCt = Number(settings.energy_price_ct_kwh);
  const feedInCt = Number(settings.feed_in_ct_kwh);
  const selfUsedKwh = Math.max(0, pvWh - exportWh) / 1000;

  // SOC range
  const socs = marstek.map((r) => r.battery_soc_pct).filter((v): v is number => v != null);
  const socMinPct = socs.length ? Math.min(...socs) : null;
  const socMaxPct = socs.length ? Math.max(...socs) : null;
  const socEndPct = socs.length ? socs[socs.length - 1] : null;

  const totalThroughputKwh = (pvToBatteryWh + batteryToHomeWh) / 1000;
  const cyclesEquivalent =
    totalThroughputKwh / (2 * (BATTERY_CAPACITY_WH / 1000));

  return {
    pvProducedKwh: pvWh / 1000,
    consumptionKwh: consumptionWh / 1000,
    outputKwh: outputI.pos / 1000,
    importKwh: importWh / 1000,
    exportKwh: exportWh / 1000,
    batteryChargedKwh: pvToBatteryWh / 1000,
    batteryDischargedKwh: batteryToHomeWh / 1000,
    pvToBatteryKwh: pvToBatteryWh / 1000,
    pvToHomeKwh: pvToHomeWh / 1000,
    batteryToHomeKwh: batteryToHomeWh / 1000,
    homeToGridKwh: exportWh / 1000,
    gridToHomeKwh: importWh / 1000,
    socMinPct,
    socMaxPct,
    socEndPct,
    cyclesEquivalent,
    selfConsumptionPct,
    autarkyPct,
    costAvoidedEur: selfUsedKwh * (energyCt / 100),
    feedInRevenueEur: (exportWh / 1000) * (feedInCt / 100),
    costImportedEur: (importWh / 1000) * (energyCt / 100),
    costWithoutSystemEur: (consumptionWh / 1000) * (energyCt / 100),
  };
}

// ─── Live ("now") computation ─────────────────────────────────────────────

export type LiveState = {
  pvW: number | null;
  outputW: number | null;
  saldoW: number | null;
  consumptionW: number | null;
  batteryFlowW: number | null;
  socPct: number | null;
  storedWh: number | null;
  pvToBatteryW: number;
  pvToHomeW: number;
  batteryToHomeW: number;
  homeToGridW: number;
  gridToHomeW: number;
  scene: string | null;
};

const BATTERY_CAPACITY_WH = 2240;

export function deriveLive(
  latestShelly: { total_w: number; ts: string } | null,
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

  return {
    pvW, outputW, saldoW, consumptionW, batteryFlowW, socPct, storedWh,
    pvToBatteryW: Math.max(0, pv - out),
    pvToHomeW: Math.min(pv, out),
    batteryToHomeW: Math.max(0, out - pv),
    homeToGridW: Math.max(0, -sal),
    gridToHomeW: Math.max(0, sal),
    scene: (rawMarstek as { scene?: string } | null)?.scene ?? null,
  };
}

export const BATTERY_CAPACITY_WH_CONST = BATTERY_CAPACITY_WH;

// ─── Per-day aggregates (for week/month bar chart) ────────────────────────

export type DailyAggregate = {
  date: string;          // YYYY-MM-DD (local)
  dateMs: number;        // noon of that day, for x-axis
  pvProducedKwh: number;
  consumptionKwh: number;
  importKwh: number;
  exportKwh: number;
  netSaldoKwh: number;   // + = net bezug, − = net einspeisung
  cyclesEquivalent: number;
  socMinPct: number | null;
  socMaxPct: number | null;
};

// ─── RPC-based aggregation (week/month views) ─────────────────────────────
// Server-side daily rollup eliminates the per-row download and the dozens
// of paginated requests it would require. The functions below derive the
// existing chart/diagram shapes from the RPC rows.

function dayMidnightMs(date: string): number {
  // The RPC returns YYYY-MM-DD in the requested tz. We anchor each bar at
  // noon UTC of that calendar date — visually correct for German users
  // since the offset stays well within the bar's day.
  return new Date(date + "T12:00:00Z").getTime();
}

/** Sum daily rollup rows into a full PeriodAggregates totals object. */
export function periodAggregatesFromDaily(
  daily: DailyAggregateRow[],
  settings: UserSettings,
): PeriodAggregates {
  const sum = (k: keyof DailyAggregateRow) =>
    daily.reduce((acc, d) => acc + ((d[k] as number | null) ?? 0), 0);

  const pvProducedKwh = sum("pv_kwh");
  const outputKwh = sum("output_kwh");
  const importKwh = sum("import_kwh");
  const exportKwh = sum("export_kwh");
  const pvToBatteryKwh = sum("pv_to_battery_kwh");
  const pvToHomeKwh = sum("pv_to_home_kwh");
  const batteryToHomeKwh = sum("battery_to_home_kwh");

  // consumptionKwh = outputKwh + (importKwh − exportKwh)
  const consumptionKwh = outputKwh + importKwh - exportKwh;

  const socMins = daily
    .map((d) => d.soc_min_pct)
    .filter((v): v is number => v != null);
  const socMaxes = daily
    .map((d) => d.soc_max_pct)
    .filter((v): v is number => v != null);
  const socMinPct = socMins.length ? Math.min(...socMins) : null;
  const socMaxPct = socMaxes.length ? Math.max(...socMaxes) : null;
  // Most recent day with a non-null SOC sample.
  const socEndPct =
    [...daily].reverse().find((d) => d.soc_end_pct != null)?.soc_end_pct ?? null;

  const cyclesEquivalent =
    (pvToBatteryKwh + batteryToHomeKwh) / (2 * (BATTERY_CAPACITY_WH / 1000));

  const selfConsumptionPct =
    pvProducedKwh > 0
      ? clamp(((pvProducedKwh - exportKwh) / pvProducedKwh) * 100, 0, 100)
      : null;
  const autarkyPct =
    consumptionKwh > 0
      ? clamp(((consumptionKwh - importKwh) / consumptionKwh) * 100, 0, 100)
      : null;

  const energyCt = Number(settings.energy_price_ct_kwh);
  const feedInCt = Number(settings.feed_in_ct_kwh);
  const selfUsedKwh = Math.max(0, pvProducedKwh - exportKwh);

  return {
    pvProducedKwh,
    consumptionKwh,
    outputKwh,
    importKwh,
    exportKwh,
    batteryChargedKwh: pvToBatteryKwh,
    batteryDischargedKwh: batteryToHomeKwh,
    pvToBatteryKwh,
    pvToHomeKwh,
    batteryToHomeKwh,
    homeToGridKwh: exportKwh,
    gridToHomeKwh: importKwh,
    socMinPct,
    socMaxPct,
    socEndPct,
    cyclesEquivalent,
    selfConsumptionPct,
    autarkyPct,
    costAvoidedEur: selfUsedKwh * (energyCt / 100),
    feedInRevenueEur: exportKwh * (feedInCt / 100),
    costImportedEur: importKwh * (energyCt / 100),
    costWithoutSystemEur: consumptionKwh * (energyCt / 100),
  };
}

/** Map RPC rows to the bar-chart's per-day shape. */
export function dailyAggregatesFromRpc(
  daily: DailyAggregateRow[],
): DailyAggregate[] {
  return daily.map((d) => {
    const consumptionKwh = d.output_kwh + d.import_kwh - d.export_kwh;
    const cyclesEquivalent =
      (d.pv_to_battery_kwh + d.battery_to_home_kwh) /
      (2 * (BATTERY_CAPACITY_WH / 1000));
    return {
      date: d.day,
      dateMs: dayMidnightMs(d.day),
      pvProducedKwh: d.pv_kwh,
      consumptionKwh,
      importKwh: d.import_kwh,
      exportKwh: d.export_kwh,
      netSaldoKwh: d.import_kwh - d.export_kwh,
      cyclesEquivalent,
      socMinPct: d.soc_min_pct,
      socMaxPct: d.soc_max_pct,
    };
  });
}
