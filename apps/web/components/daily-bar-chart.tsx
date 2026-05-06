"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyAggregate } from "@/lib/aggregates";

const C = {
  pv: "#10b981",
  consumption: "#71717a",
  bezug: "#dc2626",
  einspeisung: "#3b82f6",
};

function fmtKwh(v: number) {
  return `${v.toFixed(1).replace(".", ",")} kWh`;
}

function dayLabel(ts: number) {
  return new Date(ts).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  });
}

type TooltipProps = {
  active?: boolean;
  label?: number;
  payload?: Array<{ payload?: DailyAggregate }>;
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
        <Row color={C.pv}          label="PV produziert" value={d.pvProducedKwh} />
        <Row color={C.consumption} label="Verbrauch"     value={d.consumptionKwh} />
        <Row color={d.netSaldoKwh > 0 ? C.bezug : C.einspeisung}
          label={d.netSaldoKwh > 0 ? "Netto Bezug" : "Netto Einspeisung"}
          value={Math.abs(d.netSaldoKwh)} />
        {d.cyclesEquivalent > 0 ? (
          <div className="mt-1 border-t border-ink-100 pt-1 text-ink-500">
            {d.cyclesEquivalent.toFixed(2).replace(".", ",")} Speicher-Zyklen
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-ink-600">{label}</span>
      <span className="ml-auto font-mono tabular-nums text-ink-900">{fmtKwh(value)}</span>
    </div>
  );
}

export function DailyBarChart({ days }: { days: DailyAggregate[] }) {
  if (!days.length) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-ink-500">
        Noch keine Daten für diesen Zeitraum.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e4e4e7" vertical={false} />
        <XAxis
          dataKey="dateMs"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={dayLabel}
          stroke="#a1a1aa"
          tickLine={false}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          tickFormatter={(v: number) => fmtKwh(v)}
          stroke="#a1a1aa"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          width={70}
        />
        <ReferenceLine y={0} stroke="#a1a1aa" />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="pvProducedKwh" name="PV produziert" fill={C.pv} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="consumptionKwh" name="Verbrauch"    fill={C.consumption} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="netSaldoKwh"   name="Saldo" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {days.map((d) => (
            <Cell key={d.date} fill={d.netSaldoKwh > 0 ? C.bezug : C.einspeisung} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailyBarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">
      <Item color={C.pv} label="PV produziert" />
      <Item color={C.consumption} label="Verbrauch" />
      <Item color={C.bezug} label="Netto Bezug" />
      <Item color={C.einspeisung} label="Netto Einspeisung" />
    </div>
  );
}

function Item({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}
