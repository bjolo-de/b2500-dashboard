// Merge shelly and marstek time series into a single array for charting.
// Strategy: union of timestamps from both sources, forward-fill each metric.

import type { ShellyRow, MarstekRow } from "./queries";

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

export function enrichStacked(points: ChartPoint[]): StackedAreaPoint[] {
  return points.map((p) => {
    const pv = p.pv ?? 0;
    const output = p.output ?? 0;
    const saldo = p.saldo ?? 0;
    return {
      ...p,
      pvDirect: Math.min(pv, output),
      batteryDischarge: Math.max(0, output - pv),
      gridImport: Math.max(0, saldo),
      batteryCharge: -Math.max(0, pv - output),
      gridExport: -Math.max(0, -saldo),
    };
  });
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

export function dailySocBands(marstek: MarstekRow[]): DailySocBand[] {
  const byDay = new Map<string, { min: number; max: number; ms: number }>();
  for (const m of marstek) {
    if (m.battery_soc_pct == null) continue;
    const d = new Date(m.ts);
    const key = d.toISOString().slice(0, 10);
    const ms = new Date(key + "T12:00:00Z").getTime();
    const cur = byDay.get(key);
    if (!cur) {
      byDay.set(key, { min: m.battery_soc_pct, max: m.battery_soc_pct, ms });
    } else {
      cur.min = Math.min(cur.min, m.battery_soc_pct);
      cur.max = Math.max(cur.max, m.battery_soc_pct);
    }
  }
  return Array.from(byDay.entries())
    .map(([date, v]) => ({ date, dateMs: v.ms, min: v.min, max: v.max }))
    .sort((a, b) => a.dateMs - b.dateMs);
}
