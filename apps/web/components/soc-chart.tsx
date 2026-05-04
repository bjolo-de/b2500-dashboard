"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart,
  Bar,
  ErrorBar,
} from "recharts";
import type { ChartPoint } from "@/lib/timeseries";
import type { DailySocBand } from "@/lib/timeseries";
import { formatTime } from "@/lib/format";

export function SocChartToday({ points }: { points: ChartPoint[] }) {
  const data = points.filter((p) => p.soc != null);
  if (data.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-ink-500">
        Noch keine SOC-Daten.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e4e4e7" vertical={false} />
        <XAxis
          dataKey="tsMs"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v: number) => formatTime(new Date(v).toISOString())}
          tick={{ fontSize: 11 }}
          stroke="#a1a1aa"
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11 }}
          stroke="#a1a1aa"
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={{
            border: "1px solid #e4e4e7",
            borderRadius: 12,
            fontSize: 12,
          }}
          formatter={(v: number) => [`${Math.round(v)} %`, "SOC"]}
          labelFormatter={(v: number) =>
            new Date(v).toLocaleString("de-DE", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          }
        />
        <Line
          type="linear"
          dataKey="soc"
          stroke="#f97316"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Min/max bands per day for week/month views.
export function SocChartBands({ bands }: { bands: DailySocBand[] }) {
  if (bands.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-ink-500">
        Noch keine SOC-Daten.
      </div>
    );
  }
  // Recharts ErrorBar wants center + delta. Center = midpoint, delta = half-range.
  const data = bands.map((b) => ({
    dateMs: b.dateMs,
    mid: (b.min + b.max) / 2,
    range: [b.min, b.max] as [number, number],
    delta: (b.max - b.min) / 2,
    label: b.date,
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e4e4e7" vertical={false} />
        <XAxis
          dataKey="dateMs"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v: number) =>
            new Date(v).toLocaleDateString("de-DE", {
              day: "2-digit",
              month: "2-digit",
            })
          }
          tick={{ fontSize: 11 }}
          stroke="#a1a1aa"
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11 }}
          stroke="#a1a1aa"
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={{
            border: "1px solid #e4e4e7",
            borderRadius: 12,
            fontSize: 12,
          }}
          formatter={(_v, _n, p: { payload?: { range?: [number, number] } }) => {
            const r = p?.payload?.range;
            return r ? [`${r[0]} – ${r[1]} %`, "SOC Min – Max"] : ["—", ""];
          }}
          labelFormatter={(v: number) =>
            new Date(v).toLocaleDateString("de-DE", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })
          }
        />
        <Bar dataKey="mid" fill="transparent" isAnimationActive={false}>
          <ErrorBar dataKey="delta" stroke="#f97316" strokeWidth={2} width={6} />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
