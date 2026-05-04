"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPoint } from "@/lib/timeseries";
import { formatTime, formatW } from "@/lib/format";

const COLOR = {
  pv: "#10b981",
  saldo: "#3b82f6",
  soc: "#f97316",
};

function xTickFormatter(ms: number) {
  return formatTime(new Date(ms).toISOString());
}

function tooltipLabel(ms: number) {
  const d = new Date(ms);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MainChart({ points }: { points: ChartPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-ink-500">
        Noch keine Daten für diesen Zeitraum.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e4e4e7" strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey="tsMs"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={xTickFormatter}
          tick={{ fontSize: 11 }}
          stroke="#a1a1aa"
          tickLine={false}
        />
        <YAxis
          yAxisId="w"
          tickFormatter={(v) => formatW(v)}
          tick={{ fontSize: 11 }}
          stroke="#a1a1aa"
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <YAxis
          yAxisId="soc"
          orientation="right"
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11 }}
          stroke="#a1a1aa"
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <ReferenceLine y={0} yAxisId="w" stroke="#d4d4d8" />
        <Tooltip
          labelFormatter={tooltipLabel}
          contentStyle={{
            border: "1px solid #e4e4e7",
            borderRadius: 12,
            fontSize: 12,
            boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
          }}
          formatter={(value: number, name: string) => {
            if (name === "SOC") return [`${Math.round(value)} %`, name];
            return [formatW(value), name];
          }}
        />
        <Line
          yAxisId="w"
          type="linear"
          dataKey="pv"
          name="PV"
          stroke={COLOR.pv}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          yAxisId="w"
          type="linear"
          dataKey="saldo"
          name="Saldo"
          stroke={COLOR.saldo}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          yAxisId="soc"
          type="linear"
          dataKey="soc"
          name="SOC"
          stroke={COLOR.soc}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MainChartLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">
      <LegendDot color={COLOR.pv} label="PV-Produktion" />
      <LegendDot color={COLOR.saldo} label="Netz-Saldo (+ Bezug, − Einspeisung)" />
      <LegendDot color={COLOR.soc} label="Speicher-SOC" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
    </div>
  );
}
