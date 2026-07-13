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
import type { MonthlyAggregate } from "@/lib/aggregates";
import { FLOW_COLORS as C } from "./chart-shared";

// Year view: 12 sign-stacked monthly columns — the week/month daily bars one
// zoom level higher. The axis always spans Jan–Dez, so a partial year shows
// how the PV season builds up.

// Single letters: twelve forced ticks stay collision-free down to phone
// width; the tooltip carries the full month name.
const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

type Datum = MonthlyAggregate & { chargeNeg: number; exportNeg: number };

function fmtKwh(v: number) {
  return `${v.toFixed(1).replace(".", ",")} kWh`;
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
        {new Date(d.monthMs).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}
      </div>
      <div className="mt-1.5 space-y-0.5">
        <Row color={C.pvDirect}         label="PV-direkt → Wohnung" value={d.pvToHomeKwh} />
        <Row color={C.batteryDischarge} label="Speicher → Wohnung"  value={d.batteryToHomeKwh} />
        <Row color={C.gridImport}       label="Netz → Wohnung"      value={d.importKwh} />
        <div className="flex items-center gap-2 border-t border-ink-100 pt-1">
          <span className="font-medium text-ink-700">Verbrauch</span>
          <span className="ml-auto font-mono tabular-nums font-medium text-ink-900">{fmtKwh(d.consumptionKwh)}</span>
        </div>
        <Row color={C.batteryCharge} label="PV → Speicher"  value={d.pvToBatteryKwh} />
        <Row color={C.gridExport}    label="Wohnung → Netz" value={d.exportKwh} />
        <div className="flex items-center gap-2 border-t border-ink-100 pt-1 text-ink-500">
          <span>PV produziert</span>
          <span className="ml-auto font-mono tabular-nums">{fmtKwh(d.pvProducedKwh)}</span>
        </div>
        {d.cyclesEquivalent > 0 ? (
          <div className="text-ink-500">
            {d.cyclesEquivalent.toFixed(1).replace(".", ",")} Speicher-Zyklen
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
  return `${s} kWh`; // nbsp — Recharts wraps tick text on plain spaces
}

export function MonthlyBarChart({
  months,
  year,
}: {
  months: MonthlyAggregate[];
  year: number;
}) {
  if (!months.length) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-ink-500">
        Noch keine Daten für diesen Zeitraum.
      </div>
    );
  }
  const data: Datum[] = months.map((m) => ({
    ...m,
    chargeNeg: -m.pvToBatteryKwh,
    exportNeg: -m.exportKwh,
  }));
  const domain: [number, number] = [Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)];
  const ticks = MONTH_LABELS.map((_, i) => Date.UTC(year, i, 15, 12));
  const barProps = { maxBarSize: 28, isAnimationActive: false, stroke: "#fff", strokeWidth: 0.5 } as const;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e4e4e7" vertical={false} />
        <XAxis
          dataKey="monthMs"
          type="number"
          domain={domain}
          ticks={ticks}
          interval={0}
          tickFormatter={(ts: number) => MONTH_LABELS[new Date(ts).getUTCMonth()]}
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
