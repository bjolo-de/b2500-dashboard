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
import type { DailyAggregate } from "@/lib/aggregates";
import {
  FLOW_COLORS as C,
  FlowLegend,
  calendarDomain,
  dayTickLabel,
  labelTicks,
} from "./chart-shared";

// Consumption is stacked from its sources (PV-direkt + Speicher + Netz), the
// surplus side (PV → Speicher, Einspeisung) hangs below zero — the same
// decomposition as the day view. This keeps everything on one scale instead
// of racing bars of very different magnitude (Verbrauch vs. PV) against
// each other.

type Datum = DailyAggregate & { chargeNeg: number; exportNeg: number };

function fmtKwh(v: number) {
  return `${v.toFixed(2).replace(".", ",")} kWh`;
}

type TooltipProps = {
  active?: boolean;
  label?: number;
  payload?: Array<{ payload?: Datum }>;
};

function CustomTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length || label == null) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-ink-900">
        {new Date(label).toLocaleDateString("de-DE", {
          weekday: "long", day: "2-digit", month: "long",
        })}
      </div>
      <div className="mt-1.5 space-y-0.5">
        <Row color={C.pvDirect}         label="PV-direkt → Wohnung" value={d.pvToHomeKwh} />
        <Row color={C.batteryDischarge} label="Speicher → Wohnung"  value={d.batteryToHomeKwh} />
        <Row color={C.gridImport}       label="Netz → Wohnung"      value={d.importKwh} />
        <div className="flex items-center gap-2 border-t border-ink-100 pt-1">
          <span className="font-medium text-ink-700">Verbrauch</span>
          <span className="ml-auto font-mono tabular-nums font-medium text-ink-900">{fmtKwh(d.consumptionKwh)}</span>
        </div>
        <Row color={C.batteryCharge} label="PV → Speicher" value={d.pvToBatteryKwh} />
        <Row color={C.gridExport}    label="Wohnung → Netz" value={d.exportKwh} />
        <div className="flex items-center gap-2 border-t border-ink-100 pt-1 text-ink-500">
          <span>PV produziert</span>
          <span className="ml-auto font-mono tabular-nums">{fmtKwh(d.pvProducedKwh)}</span>
        </div>
        {d.cyclesEquivalent > 0 ? (
          <div className="text-ink-500">
            {d.cyclesEquivalent.toFixed(2).replace(".", ",")} Speicher-Zyklen
          </div>
        ) : null}
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
  return `${s} kWh`;
}

export function DailyBarChart({
  days,
  dayTicks,
}: {
  days: DailyAggregate[];
  /** Noon-anchored ms for every calendar day of the period. */
  dayTicks: number[];
}) {
  if (!days.length) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-ink-500">
        Noch keine Daten für diesen Zeitraum.
      </div>
    );
  }
  const data: Datum[] = days.map((d) => ({
    ...d,
    chargeNeg: -d.pvToBatteryKwh,
    exportNeg: -d.exportKwh,
  }));
  const domain = calendarDomain(dayTicks) ?? (["dataMin", "dataMax"] as const);
  // Hairline surface gap between stacked segments — 0.5px so month bars
  // (~6px wide on phones) keep their fill visible.
  const barProps = { maxBarSize: 22, isAnimationActive: false, stroke: "#fff", strokeWidth: 0.5 } as const;

  return (
    <ResponsiveContainer width="100%" height={260}>
      {/* stackOffset="sign": consumption sources stack upward, surplus flows
          stack downward in the SAME column — separate stackIds would render
          two skinny side-by-side bars per day. */}
      <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e4e4e7" vertical={false} />
        <XAxis
          dataKey="dateMs"
          type="number"
          domain={domain as [number, number]}
          ticks={labelTicks(dayTicks)}
          interval={0}
          tickFormatter={dayTickLabel}
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
        <Bar dataKey="pvToHomeKwh"      stackId="a" name="PV-direkt → Wohnung" fill={C.pvDirect}         {...barProps} />
        <Bar dataKey="batteryToHomeKwh" stackId="a" name="Speicher → Wohnung"  fill={C.batteryDischarge} {...barProps} />
        <Bar dataKey="importKwh"        stackId="a" name="Netz → Wohnung"      fill={C.gridImport}       {...barProps} />
        <Bar dataKey="chargeNeg"        stackId="a" name="PV → Speicher"       fill={C.batteryCharge}    {...barProps} />
        <Bar dataKey="exportNeg"        stackId="a" name="Wohnung → Netz"      fill={C.gridExport}       {...barProps} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailyBarLegend() {
  return <FlowLegend />;
}
