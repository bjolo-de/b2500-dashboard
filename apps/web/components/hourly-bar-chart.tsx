"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HourlyEnergyPoint } from "@/lib/timeseries";
import { FLOW_COLORS as C } from "./chart-shared";

// Day view as 24 sign-stacked hourly columns — the same decomposition and
// colors as the week/month daily bars, one zoom level deeper. Energy per
// hour instead of a power curve: no clipping heuristics needed, since
// integration flattens short multi-kW spikes.

function fmtKwh(v: number) {
  return `${v.toFixed(2).replace(".", ",")} kWh`;
}

function hourLabel(ts: number) {
  return new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

type TooltipProps = {
  active?: boolean;
  label?: number;
  payload?: Array<{ payload?: HourlyEnergyPoint }>;
};

function CustomTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length || label == null) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-ink-900">
        {hourLabel(d.hourStartMs)} – {hourLabel(d.hourStartMs + 3_600_000)} Uhr
      </div>
      <div className="mt-1.5 space-y-0.5">
        <Row color={C.pvDirect}         label="PV-direkt → Wohnung" value={d.pvDirectKwh} />
        <Row color={C.batteryDischarge} label="Speicher → Wohnung"  value={d.batteryDischargeKwh} />
        <Row color={C.gridImport}       label="Netz → Wohnung"      value={d.gridImportKwh} />
        <div className="flex items-center gap-2 border-t border-ink-100 pt-1">
          <span className="font-medium text-ink-700">Verbrauch</span>
          <span className="ml-auto font-mono tabular-nums font-medium text-ink-900">{fmtKwh(d.consumptionKwh)}</span>
        </div>
        <Row color={C.batteryCharge} label="PV → Speicher"  value={-d.batteryChargeKwh} />
        <Row color={C.gridExport}    label="Wohnung → Netz" value={-d.gridExportKwh} />
      </div>
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: number }) {
  if (value < 0.005) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-ink-600">{label}</span>
      <span className="ml-auto font-mono tabular-nums text-ink-900">{fmtKwh(value)}</span>
    </div>
  );
}

function axisKwh(v: number): string {
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",");
  return `${s} kWh`; // nbsp — Recharts wraps tick text on plain spaces
}

export function HourlyBarChart({
  hours,
  fromMs,
}: {
  hours: HourlyEnergyPoint[];
  /** Local midnight of the shown day — the axis always spans 00–24 h. */
  fromMs: number;
}) {
  if (!hours.length) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-ink-500">
        Noch keine Daten für diesen Zeitraum.
      </div>
    );
  }
  const toMs = fromMs + 24 * 3_600_000;
  const ticks = Array.from({ length: 7 }, (_, i) => fromMs + i * 4 * 3_600_000);
  // The right edge is next midnight — label it 24:00, not a confusing 00:00.
  const tickLabel = (ts: number) => (ts === toMs ? "24:00" : hourLabel(ts));
  const barProps = { maxBarSize: 22, isAnimationActive: false, stroke: "#fff", strokeWidth: 0.5 } as const;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={hours} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e4e4e7" vertical={false} />
        <XAxis
          dataKey="hourMs"
          type="number"
          domain={[fromMs, toMs]}
          ticks={ticks}
          tickFormatter={tickLabel}
          stroke="#a1a1aa"
          tickLine={false}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          tickFormatter={axisKwh}
          stroke="#a1a1aa"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          width={56}
        />
        <ReferenceLine y={0} stroke="#a1a1aa" />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="pvDirectKwh"         stackId="a" name="PV-direkt → Wohnung" fill={C.pvDirect}         {...barProps} />
        <Bar dataKey="batteryDischargeKwh" stackId="a" name="Speicher → Wohnung"  fill={C.batteryDischarge} {...barProps} />
        <Bar dataKey="gridImportKwh"       stackId="a" name="Netz → Wohnung"      fill={C.gridImport}       {...barProps} />
        <Bar dataKey="batteryChargeKwh"    stackId="a" name="PV → Speicher"       fill={C.batteryCharge}    {...barProps} />
        <Bar dataKey="gridExportKwh"       stackId="a" name="Wohnung → Netz"      fill={C.gridExport}       {...barProps} />
      </BarChart>
    </ResponsiveContainer>
  );
}
