"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatTime, formatW } from "@/lib/format";
import type { StackedAreaPoint } from "@/lib/timeseries";
import { FLOW_COLORS as C, FLOW_SERIES as SERIES, FlowLegend } from "./chart-shared";

// Y-axis hard clip. Inrush spikes (kettle, coffee machine) often briefly read
// 5–20 kW for ~1 s and crush the visible range otherwise. 3 kW covers every
// realistic sustained household load in this apartment. Values beyond are
// drawn outside the plot area and Recharts clips them via its built-in
// clipPath; the tooltip still reports the raw value.
const Y_CLIP = 3000;

type TooltipProps = {
  active?: boolean;
  label?: number;
  payload?: Array<{ payload?: StackedAreaPoint }>;
};

function CustomTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length || label == null) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  const consumption = data.pvDirect + data.batteryDischarge + data.gridImport;
  const surplus = -(data.batteryCharge + data.gridExport);
  const clipped =
    consumption > Y_CLIP || surplus > Y_CLIP;
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-ink-900">
        {new Date(label).toLocaleString("de-DE", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        })}
      </div>
      <div className="mt-1.5 space-y-0.5">
        {SERIES.map((s) => {
          const raw = (data as unknown as Record<string, number>)[s.key];
          if (raw == null || Math.abs(raw) < 1) return null;
          return (
            <div key={s.key} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-ink-600">{s.label}</span>
              <span className="ml-auto font-mono tabular-nums text-ink-900">{formatW(Math.abs(raw))}</span>
            </div>
          );
        })}
        {data.soc != null ? (
          <div className="mt-1 flex items-center gap-2 border-t border-ink-100 pt-1">
            <span className="text-ink-600">SOC</span>
            <span className="ml-auto font-mono tabular-nums text-ink-900">{Math.round(data.soc)} %</span>
          </div>
        ) : null}
        {clipped ? (
          <div className="mt-1 text-[10px] italic text-ink-400">
            Skala bei ±{Y_CLIP / 1000} kW geclippt — Echtwerte siehe oben
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StackedAreaChart({
  points,
  fromMs,
  toMs,
}: {
  points: StackedAreaPoint[];
  /** Full-day domain — the axis always spans 00–24 h, not just "until now". */
  fromMs?: number;
  toMs?: number;
}) {
  if (!points.length) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-ink-500">
        Noch keine Daten für diesen Zeitraum.
      </div>
    );
  }
  const hasDomain = fromMs != null && toMs != null;
  const hourTicks = hasDomain
    ? Array.from({ length: 7 }, (_, i) => fromMs + (i * (toMs - fromMs)) / 6)
    : undefined;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e4e4e7" vertical={false} />
        <XAxis
          dataKey="tsMs"
          type="number"
          domain={hasDomain ? [fromMs, toMs] : ["dataMin", "dataMax"]}
          ticks={hourTicks}
          allowDataOverflow
          tickFormatter={(v: number) => formatTime(new Date(v).toISOString())}
          stroke="#a1a1aa"
          tickLine={false}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          domain={[-Y_CLIP, Y_CLIP]}
          allowDataOverflow
          tickFormatter={(v: number) => formatW(v)}
          stroke="#a1a1aa"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          width={60}
        />
        <ReferenceLine y={0} stroke="#a1a1aa" />
        <Area type="linear" dataKey="pvDirect"         stackId="pos" stroke={C.pvDirect}         fill={C.pvDirect}         fillOpacity={0.55} isAnimationActive={false} />
        <Area type="linear" dataKey="batteryDischarge" stackId="pos" stroke={C.batteryDischarge} fill={C.batteryDischarge} fillOpacity={0.55} isAnimationActive={false} />
        <Area type="linear" dataKey="gridImport"       stackId="pos" stroke={C.gridImport}       fill={C.gridImport}       fillOpacity={0.55} isAnimationActive={false} />
        <Area type="linear" dataKey="batteryCharge"    stackId="neg" stroke={C.batteryCharge}    fill={C.batteryCharge}    fillOpacity={0.6}  isAnimationActive={false} />
        <Area type="linear" dataKey="gridExport"       stackId="neg" stroke={C.gridExport}       fill={C.gridExport}       fillOpacity={0.6}  isAnimationActive={false} />
        <Tooltip content={<CustomTooltip />} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function StackedAreaLegend() {
  return <FlowLegend />;
}
