"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatTime, formatW } from "@/lib/format";
import type { StackedAreaPoint } from "@/lib/timeseries";

const C = {
  pvDirect: "#10b981",
  batteryDischarge: "#f97316",
  gridImport: "#dc2626",
  batteryCharge: "#86efac",
  gridExport: "#3b82f6",
  soc: "#a855f7",
};

const SERIES = [
  { key: "pvDirect", label: "PV-direkt → Wohnung", color: C.pvDirect, sign: 1 },
  { key: "batteryDischarge", label: "Speicher → Wohnung", color: C.batteryDischarge, sign: 1 },
  { key: "gridImport", label: "Netz → Wohnung", color: C.gridImport, sign: 1 },
  { key: "batteryCharge", label: "PV → Speicher", color: C.batteryCharge, sign: -1 },
  { key: "gridExport", label: "Wohnung → Netz", color: C.gridExport, sign: -1 },
] as const;

type TooltipProps = {
  active?: boolean;
  label?: number;
  payload?: Array<{ dataKey?: string; value?: number; payload?: StackedAreaPoint }>;
};

function CustomTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length || label == null) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
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
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: C.soc }} />
            <span className="text-ink-600">SOC</span>
            <span className="ml-auto font-mono tabular-nums text-ink-900">{Math.round(data.soc)} %</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StackedAreaChart({ points }: { points: StackedAreaPoint[] }) {
  if (!points.length) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-ink-500">
        Noch keine Daten für diesen Zeitraum.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e4e4e7" vertical={false} />
        <XAxis
          dataKey="tsMs"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v: number) => formatTime(new Date(v).toISOString())}
          stroke="#a1a1aa"
          tickLine={false}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          yAxisId="w"
          tickFormatter={(v: number) => formatW(v)}
          stroke="#a1a1aa"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          width={60}
        />
        <YAxis
          yAxisId="soc"
          orientation="right"
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
          stroke="#a1a1aa"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          width={36}
        />
        <ReferenceLine y={0} yAxisId="w" stroke="#a1a1aa" />
        <Area yAxisId="w" type="linear" dataKey="pvDirect"         stackId="pos" stroke={C.pvDirect}         fill={C.pvDirect}         fillOpacity={0.55} isAnimationActive={false} />
        <Area yAxisId="w" type="linear" dataKey="batteryDischarge" stackId="pos" stroke={C.batteryDischarge} fill={C.batteryDischarge} fillOpacity={0.55} isAnimationActive={false} />
        <Area yAxisId="w" type="linear" dataKey="gridImport"       stackId="pos" stroke={C.gridImport}       fill={C.gridImport}       fillOpacity={0.55} isAnimationActive={false} />
        <Area yAxisId="w" type="linear" dataKey="batteryCharge"    stackId="neg" stroke={C.batteryCharge}    fill={C.batteryCharge}    fillOpacity={0.6}  isAnimationActive={false} />
        <Area yAxisId="w" type="linear" dataKey="gridExport"       stackId="neg" stroke={C.gridExport}       fill={C.gridExport}       fillOpacity={0.6}  isAnimationActive={false} />
        <Line yAxisId="soc" type="linear" dataKey="soc" stroke={C.soc} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Tooltip content={<CustomTooltip />} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function StackedAreaLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">
      {SERIES.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          <span>{s.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-3" style={{ background: C.soc }} />
        <span>SOC</span>
      </div>
    </div>
  );
}
