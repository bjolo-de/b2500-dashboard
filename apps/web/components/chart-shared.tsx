"use client";

// Shared chart vocabulary: one color/label per energy flow, used identically
// by the day view (stacked areas, W) and the week/month view (stacked bars,
// kWh) so both charts read as the same system.

export const FLOW_COLORS = {
  pvDirect: "#10b981",
  batteryDischarge: "#f97316",
  gridImport: "#dc2626",
  batteryCharge: "#86efac",
  gridExport: "#3b82f6",
};

export const FLOW_SERIES = [
  { key: "pvDirect", label: "PV-direkt → Wohnung", color: FLOW_COLORS.pvDirect, sign: 1 },
  { key: "batteryDischarge", label: "Speicher → Wohnung", color: FLOW_COLORS.batteryDischarge, sign: 1 },
  { key: "gridImport", label: "Netz → Wohnung", color: FLOW_COLORS.gridImport, sign: 1 },
  { key: "batteryCharge", label: "PV → Speicher", color: FLOW_COLORS.batteryCharge, sign: -1 },
  { key: "gridExport", label: "Wohnung → Netz", color: FLOW_COLORS.gridExport, sign: -1 },
] as const;

export function FlowLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">
      {FLOW_SERIES.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Calendar x-axis helpers ──────────────────────────────────────────────
// Week/month charts get a fixed calendar domain (all days of the period,
// data present or not) so a young month doesn't stretch two bars across the
// full width. Bars/bands are anchored at noon per day; padding the domain by
// half a day keeps the first/last mark clear of the y-axis and card edge.

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

export function calendarDomain(dayTicks: number[]): [number, number] | undefined {
  if (!dayTicks.length) return undefined;
  return [dayTicks[0] - HALF_DAY_MS, dayTicks[dayTicks.length - 1] + HALF_DAY_MS];
}

/** All day ticks for ≤10 days (week); every 5th day for a month. */
export function labelTicks(dayTicks: number[]): number[] {
  if (dayTicks.length <= 10) return dayTicks;
  return dayTicks.filter((_, i) => i % 5 === 0);
}

export function dayTickLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}
