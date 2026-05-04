// Merge shelly and marstek time series into a single array for charting.
// Strategy: union of timestamps from both sources, forward-fill each metric.

import type { ShellyRow, MarstekRow } from "./queries";

export type ChartPoint = {
  ts: string;          // ISO
  tsMs: number;        // for Recharts numeric x-axis
  pv: number | null;        // W (PV produced by Marstek)
  saldo: number | null;     // W (grid balance from Shelly: + import, - export)
  soc: number | null;       // % (battery SOC)
  output: number | null;    // W (Marstek output to Hoymiles)
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
  // Index points by ts (string, fine for ms-precision ISO).
  const map = new Map<string, ChartPoint>();
  for (const s of shelly) {
    const tsMs = new Date(s.ts).getTime();
    map.set(s.ts, {
      ts: s.ts,
      tsMs,
      pv: null,
      saldo: s.total_w,
      soc: null,
      output: null,
    });
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
        ts: m.ts,
        tsMs,
        pv: m.pv_total_w,
        saldo: null,
        soc: m.battery_soc_pct,
        output: m.output_total_w,
      });
    }
  }
  const merged = Array.from(map.values()).sort((a, b) => a.tsMs - b.tsMs);

  // Forward-fill so each line stays continuous between samples instead of
  // dropping to null when the other source took a sample.
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

// Aggregate per-day SOC min/max for week/month views.
export type DailySocBand = {
  date: string;        // YYYY-MM-DD
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
    const ms = new Date(key + "T12:00:00Z").getTime();  // noon for x-axis
    const cur = byDay.get(key);
    if (!cur) {
      byDay.set(key, { min: m.battery_soc_pct, max: m.battery_soc_pct, ms });
    } else {
      cur.min = Math.min(cur.min, m.battery_soc_pct);
      cur.max = Math.max(cur.max, m.battery_soc_pct);
    }
  }
  return Array.from(byDay.entries())
    .map(([date, v]) => ({
      date,
      dateMs: v.ms,
      min: v.min,
      max: v.max,
    }))
    .sort((a, b) => a.dateMs - b.dateMs);
}
