// Merge shelly and marstek time series into a single array for charting.
// Strategy: union of timestamps from both sources, forward-fill each metric.

import type { DailyAggregateRow, MarstekRow, ShellyRow } from "./queries";

export type ChartPoint = {
  ts: string;
  tsMs: number;
  pv: number | null;
  saldo: number | null;
  soc: number | null;
  output: number | null;
};

function ffill<T>(arr: (T | null)[]): (T | null)[] {
  let last: T | null = null;
  return arr.map((v) => {
    if (v != null) last = v;
    return last;
  });
}

export function mergeTimeSeries(
  shelly: ShellyRow[],
  marstek: MarstekRow[],
): ChartPoint[] {
  const map = new Map<string, ChartPoint>();
  for (const s of shelly) {
    const tsMs = new Date(s.ts).getTime();
    map.set(s.ts, { ts: s.ts, tsMs, pv: null, saldo: s.total_w, soc: null, output: null });
  }
  for (const m of marstek) {
    const tsMs = new Date(m.ts).getTime();
    const existing = map.get(m.ts);
    if (existing) {
      existing.pv = m.pv_total_w;
      existing.soc = m.battery_soc_pct;
      existing.output = m.output_total_w;
    } else {
      map.set(m.ts, {
        ts: m.ts, tsMs,
        pv: m.pv_total_w,
        saldo: null,
        soc: m.battery_soc_pct,
        output: m.output_total_w,
      });
    }
  }
  const merged = Array.from(map.values()).sort((a, b) => a.tsMs - b.tsMs);
  const pv = ffill(merged.map((m) => m.pv));
  const saldo = ffill(merged.map((m) => m.saldo));
  const soc = ffill(merged.map((m) => m.soc));
  const output = ffill(merged.map((m) => m.output));
  return merged.map((m, i) => ({
    ...m,
    pv: pv[i],
    saldo: saldo[i],
    soc: soc[i],
    output: output[i],
  }));
}

// Enrich each ChartPoint with the five components needed for the Tesla-style
// stacked-area chart: above-zero shows where home consumption came from,
// below-zero shows where surplus PV went.
export type StackedAreaPoint = ChartPoint & {
  pvDirect: number;          // PV power used directly by home (positive)
  batteryDischarge: number;  // Battery → home (positive)
  gridImport: number;        // Grid → home (positive)
  batteryCharge: number;     // PV → battery (negative for stacking below zero)
  gridExport: number;        // Home → grid (negative for stacking below zero)
};

// Exported power leaves via the below-zero band, so it must not also sit in
// the consumption stack: only the output share that stays in the home counts
// as pvDirect/batteryDischarge. That way the positive stack sums exactly to
// consumption (output − export + import) instead of overstating it.
export function enrichStacked(points: ChartPoint[]): StackedAreaPoint[] {
  return points.map((p) => {
    const pv = p.pv ?? 0;
    const output = p.output ?? 0;
    const saldo = p.saldo ?? 0;
    const exported = Math.max(0, -saldo);
    const consumedOutput = Math.max(0, output - exported);
    return {
      ...p,
      pvDirect: Math.min(pv, consumedOutput),
      batteryDischarge: Math.max(0, consumedOutput - pv),
      gridImport: Math.max(0, saldo),
      batteryCharge: -Math.max(0, pv - output),
      gridExport: -exported,
    };
  });
}

// ─── Hourly energy (day view) ─────────────────────────────────────────────
// The day view shows energy per hour instead of a power curve: integrating
// over an hour flattens short inrush spikes (2 kW kettle × 3 min = 0,1 kWh)
// that otherwise crush the scale, and matches the week/month bar semantics.

export type HourlyEnergyPoint = {
  /** Hour center (start + 30 min) — bar anchor on the numeric x-axis. */
  hourMs: number;
  hourStartMs: number;
  pvDirectKwh: number;
  batteryDischargeKwh: number;
  gridImportKwh: number;
  batteryChargeKwh: number; // negative, stacks below zero
  gridExportKwh: number;    // negative, stacks below zero
  consumptionKwh: number;
};

const HOUR_MS = 60 * 60 * 1000;

// Trapezoidal integration per flow, binned by interval midpoint — the same
// scheme as computePeriodAggregates, so hour sums line up with day totals.
export function hourlyEnergyFromPoints(points: ChartPoint[]): HourlyEnergyPoint[] {
  // Output share consumed at home (export leaves via the below-zero band —
  // same decomposition as enrichStacked, so the stack sums to consumption).
  const consumedOutput = (p: ChartPoint) =>
    Math.max(0, (p.output ?? 0) - Math.max(0, -(p.saldo ?? 0)));
  const flows = {
    pvDirect: (p: ChartPoint) => Math.min(p.pv ?? 0, consumedOutput(p)),
    batteryDischarge: (p: ChartPoint) => Math.max(0, consumedOutput(p) - (p.pv ?? 0)),
    gridImport: (p: ChartPoint) => Math.max(0, p.saldo ?? 0),
    batteryCharge: (p: ChartPoint) => Math.max(0, (p.pv ?? 0) - (p.output ?? 0)),
    gridExport: (p: ChartPoint) => Math.max(0, -(p.saldo ?? 0)),
  };
  const hours = new Map<number, Record<keyof typeof flows, number>>();
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const dtMs = cur.tsMs - prev.tsMs;
    if (dtMs <= 0 || dtMs > 600_000) continue;
    const hourKey = Math.floor((prev.tsMs + dtMs / 2) / HOUR_MS) * HOUR_MS;
    let h = hours.get(hourKey);
    if (!h) {
      h = { pvDirect: 0, batteryDischarge: 0, gridImport: 0, batteryCharge: 0, gridExport: 0 };
      hours.set(hourKey, h);
    }
    for (const key of Object.keys(flows) as (keyof typeof flows)[]) {
      const f = flows[key];
      h[key] += (((f(prev) + f(cur)) / 2) * dtMs) / 3_600_000 / 1000; // W·ms → kWh
    }
  }
  return Array.from(hours.entries())
    .sort(([a], [b]) => a - b)
    .map(([hourStartMs, h]) => ({
      hourMs: hourStartMs + HOUR_MS / 2,
      hourStartMs,
      pvDirectKwh: h.pvDirect,
      batteryDischargeKwh: h.batteryDischarge,
      gridImportKwh: h.gridImport,
      batteryChargeKwh: -h.batteryCharge,
      gridExportKwh: -h.gridExport,
      consumptionKwh: h.pvDirect + h.batteryDischarge + h.gridImport,
    }));
}

// Bucket points into fixed time windows for week/month chart resolution.
// Average power values, last-value SOC. If bucketSizeMs <= 0 → returns input.
export function bucketTimeSeries(points: ChartPoint[], bucketSizeMs: number): ChartPoint[] {
  if (bucketSizeMs <= 0 || points.length < 2) return points;
  const buckets = new Map<number, {
    tsMs: number;
    pvSum: number; pvN: number;
    saldoSum: number; saldoN: number;
    outputSum: number; outputN: number;
    socLast: number | null;
  }>();
  for (const p of points) {
    const k = Math.floor(p.tsMs / bucketSizeMs) * bucketSizeMs;
    let b = buckets.get(k);
    if (!b) {
      b = { tsMs: k, pvSum: 0, pvN: 0, saldoSum: 0, saldoN: 0, outputSum: 0, outputN: 0, socLast: null };
      buckets.set(k, b);
    }
    if (p.pv != null) { b.pvSum += p.pv; b.pvN += 1; }
    if (p.saldo != null) { b.saldoSum += p.saldo; b.saldoN += 1; }
    if (p.output != null) { b.outputSum += p.output; b.outputN += 1; }
    if (p.soc != null) b.socLast = p.soc;
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.tsMs - b.tsMs)
    .map((b) => ({
      ts: new Date(b.tsMs).toISOString(),
      tsMs: b.tsMs,
      pv: b.pvN > 0 ? b.pvSum / b.pvN : null,
      saldo: b.saldoN > 0 ? b.saldoSum / b.saldoN : null,
      output: b.outputN > 0 ? b.outputSum / b.outputN : null,
      soc: b.socLast,
    }));
}

export type DailySocBand = {
  date: string;
  dateMs: number;
  min: number;
  max: number;
};

export function socBandsFromDaily(daily: DailyAggregateRow[]): DailySocBand[] {
  return daily
    .filter(
      (d): d is DailyAggregateRow & { soc_min_pct: number; soc_max_pct: number } =>
        d.soc_min_pct != null && d.soc_max_pct != null,
    )
    .map((d) => ({
      date: d.day,
      dateMs: new Date(d.day + "T12:00:00Z").getTime(),
      min: d.soc_min_pct,
      max: d.soc_max_pct,
    }));
}
