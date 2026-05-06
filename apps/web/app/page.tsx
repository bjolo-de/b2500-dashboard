import {
  fetchHeartbeats,
  fetchLatestMarstek,
  fetchLatestShelly,
  fetchMarstekRange,
  fetchShellyRange,
  fetchUserSettings,
} from "@/lib/queries";
import {
  BATTERY_CAPACITY_WH_CONST,
  computePeriodAggregates,
  deriveLive,
  type LiveState,
  type PeriodAggregates,
} from "@/lib/aggregates";
import { classifyHealth } from "@/lib/system-health";
import { mergeTimeSeries, dailySocBands, bucketTimeSeries } from "@/lib/timeseries";
import { formatRelative } from "@/lib/format";
import { parseAnchor, rangeFor, type Period, type Range } from "@/lib/period";
import { Card, CardBody, CardHeader, CardLabel } from "@/components/ui/card";
import { PeriodSwitcher } from "@/components/period-switcher";
import { DateNavigator } from "@/components/date-navigator";
import { SystemStatus } from "@/components/system-status";
import {
  FlowDiagram,
  type ModuleSpec,
  type FlowSpec,
  type Trend,
} from "@/components/flow-diagram";
import { BalanceSummary } from "@/components/balance-summary";
import { MainChart, MainChartLegend } from "@/components/main-chart";
import { SocChartBands } from "@/components/soc-chart";
import { TariffFooter } from "@/components/tariff-footer";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 30;

const VALID_PERIODS = new Set<Period>(["today", "week", "month"]);

function asPeriod(s: string | string[] | undefined): Period {
  const v = Array.isArray(s) ? s[0] : s;
  return VALID_PERIODS.has(v as Period) ? (v as Period) : "today";
}
function asAnchor(s: string | string[] | undefined): string | undefined {
  return Array.isArray(s) ? s[0] : s;
}

const TREND_VS: Record<Period, string> = {
  today: "Vortag",
  week: "Vorwoche",
  month: "Vormonat",
};
const SCALE_KWH: Record<Period, number> = { today: 5, week: 15, month: 60 };
const BUCKET_MS: Record<Period, number> = {
  today: 0,
  week:  60 * 60 * 1000,
  month: 4 * 60 * 60 * 1000,
};

// ─── Display formatters ───────────────────────────────────────────────────

function fmtW(w: number | null): string {
  if (w == null) return "—";
  if (Math.abs(w) < 1000) return `${Math.round(w)} W`;
  return `${(w / 1000).toFixed(1).replace(".", ",")} kW`;
}
function fmtKwh(kwh: number, digits = 2): string {
  return `${kwh.toFixed(digits).replace(".", ",")} kWh`;
}
function fmtSignedW(w: number | null): string {
  if (w == null) return "—";
  const sign = w > 0 ? "+" : w < 0 ? "−" : "";
  return `${sign}${fmtW(Math.abs(w))}`;
}
function fmtSignedKwh(kwh: number, digits = 2): string {
  const sign = kwh > 0 ? "+" : kwh < 0 ? "−" : "";
  return `${sign}${Math.abs(kwh).toFixed(digits).replace(".", ",")} kWh`;
}

function trendOf(cur: number, prev: number, vs: string): Trend {
  if (Math.abs(prev) < 0.001) return { pct: null, vs };
  return { pct: ((cur - prev) / Math.abs(prev)) * 100, vs };
}

// ─── Live mode ────────────────────────────────────────────────────────────

function buildLiveDiagram(live: LiveState, todayAgg: PeriodAggregates) {
  const wScale = 800;
  const intW = (w: number) => Math.min(1, w / wScale);
  const exportingW = Math.max(0, -(live.saldoW ?? 0));
  const importingW = Math.max(0, (live.saldoW ?? 0));

  return {
    modules: {
      pv: {
        big: fmtW(live.pvW),
        small: `${fmtKwh(todayAgg.pvProducedKwh)} heute`,
        highlighted: (live.pvW ?? 0) > 1,
      },
      battery: {
        big: live.socPct != null ? `${live.socPct} %` : "—",
        small:
          live.storedWh != null
            ? `${(live.storedWh / 1000).toFixed(2).replace(".", ",")} / ${(BATTERY_CAPACITY_WH_CONST / 1000).toFixed(2).replace(".", ",")} kWh`
            : undefined,
        highlighted: Math.abs(live.batteryFlowW ?? 0) > 1,
      },
      home: {
        big: fmtW(live.consumptionW),
        small: `${fmtKwh(todayAgg.consumptionKwh)} heute`,
        highlighted: (live.consumptionW ?? 0) > 1,
      },
      grid: {
        big: fmtSignedW(live.saldoW),
        highlighted: Math.abs(live.saldoW ?? 0) > 1,
        variant: (exportingW > 0 ? "export" : importingW > 0 ? "import" : "idle") as "export" | "import" | "idle",
      },
    } satisfies Record<string, ModuleSpec>,
    flows: {
      pvHome: {
        intensity: intW(live.pvToHomeW),
        label: live.pvToHomeW >= 1 ? fmtW(live.pvToHomeW) : "",
      },
      pvBattery: {
        intensity: intW(live.pvToBatteryW),
        label: live.pvToBatteryW >= 1 ? fmtW(live.pvToBatteryW) : "",
      },
      batteryHome: {
        intensity: intW(live.batteryToHomeW),
        label: live.batteryToHomeW >= 1 ? fmtW(live.batteryToHomeW) : "",
      },
      // Wohnung → Netz (export)
      homeGrid: {
        intensity: intW(exportingW),
        label: exportingW >= 1 ? fmtW(exportingW) : "",
      },
      // Netz → Wohnung (import)
      gridHome: {
        intensity: intW(importingW),
        label: importingW >= 1 ? fmtW(importingW) : "",
      },
    } satisfies Record<string, FlowSpec>,
    tooltips: {
      pvHome: "PV-Energie, die direkt von der Wohnung verbraucht wird (nicht über den Speicher).",
      pvBattery: "PV-Überschuss, der in den Speicher fließt zur späteren Nutzung.",
      batteryHome: "Speicher entlädt sich und versorgt die Wohnung.",
      homeGrid: "Überschuss, der ins öffentliche Netz eingespeist wird.",
      gridHome: "Energie, die aus dem öffentlichen Netz bezogen wird.",
    },
  };
}

// ─── Aggregate mode ──────────────────────────────────────────────────────

function buildAggregateDiagram(
  agg: PeriodAggregates,
  prev: PeriodAggregates | null,
  period: Period,
) {
  const scale = SCALE_KWH[period];
  const intK = (kwh: number) => Math.min(1, kwh / scale);
  const vs = TREND_VS[period];

  const netSaldoKwh = agg.importKwh - agg.exportKwh; // + = bezug, − = einspeisung
  const exporting = netSaldoKwh < -0.001;
  const importing = netSaldoKwh > 0.001;

  const tr = (cur: number, prv: number | null | undefined): Trend | undefined =>
    prv == null ? undefined : trendOf(cur, prv, vs);

  return {
    modules: {
      pv: {
        big: fmtKwh(agg.pvProducedKwh),
        trend: tr(agg.pvProducedKwh, prev?.pvProducedKwh),
        highlighted: agg.pvProducedKwh > 0.01,
      },
      battery: {
        // primary = energy delivered from battery to home (the user-visible value)
        big: fmtKwh(agg.batteryDischargedKwh),
        small:
          agg.batteryChargedKwh > 0.01
            ? `${fmtKwh(agg.batteryChargedKwh)} geladen`
            : undefined,
        trend: tr(agg.batteryDischargedKwh, prev?.batteryDischargedKwh),
        highlighted: agg.batteryChargedKwh + agg.batteryDischargedKwh > 0.01,
      },
      home: {
        big: fmtKwh(agg.consumptionKwh),
        trend: tr(agg.consumptionKwh, prev?.consumptionKwh),
        highlighted: agg.consumptionKwh > 0.01,
      },
      grid: {
        big: fmtSignedKwh(netSaldoKwh),
        // Subtitle removed — bezug/einspeisung now visible as the two arrow flows.
        trend: tr(netSaldoKwh, prev != null ? (prev.importKwh - prev.exportKwh) : null),
        highlighted: agg.importKwh + agg.exportKwh > 0.01,
        variant: (exporting ? "export" : importing ? "import" : "idle") as "export" | "import" | "idle",
      },
    } satisfies Record<string, ModuleSpec>,
    flows: {
      pvHome: {
        intensity: intK(agg.pvToHomeKwh),
        label: agg.pvToHomeKwh >= 0.01 ? fmtKwh(agg.pvToHomeKwh) : "",
        trend: tr(agg.pvToHomeKwh, prev?.pvToHomeKwh),
      },
      pvBattery: {
        intensity: intK(agg.pvToBatteryKwh),
        label: agg.pvToBatteryKwh >= 0.01 ? fmtKwh(agg.pvToBatteryKwh) : "",
        trend: tr(agg.pvToBatteryKwh, prev?.pvToBatteryKwh),
      },
      batteryHome: {
        intensity: intK(agg.batteryToHomeKwh),
        label: agg.batteryToHomeKwh >= 0.01 ? fmtKwh(agg.batteryToHomeKwh) : "",
        trend: tr(agg.batteryToHomeKwh, prev?.batteryToHomeKwh),
      },
      // Two separate flows for the grid: each visible if its direction occurred.
      homeGrid: {
        intensity: intK(agg.exportKwh),
        label: agg.exportKwh >= 0.01 ? fmtKwh(agg.exportKwh) : "",
        trend: tr(agg.exportKwh, prev?.exportKwh),
      },
      gridHome: {
        intensity: intK(agg.importKwh),
        label: agg.importKwh >= 0.01 ? fmtKwh(agg.importKwh) : "",
        trend: tr(agg.importKwh, prev?.importKwh),
      },
    } satisfies Record<string, FlowSpec>,
    tooltips: {
      pvHome: `Direkt verbrauchte PV-Energie: ${fmtKwh(agg.pvToHomeKwh)}.`,
      pvBattery: `In den Speicher geflossene PV-Energie: ${fmtKwh(agg.pvToBatteryKwh)}.`,
      batteryHome: `Vom Speicher in die Wohnung gelieferte Energie: ${fmtKwh(agg.batteryToHomeKwh)}.`,
      homeGrid: `Ins öffentliche Netz eingespeist: ${fmtKwh(agg.exportKwh)}.`,
      gridHome: `Aus dem öffentlichen Netz bezogen: ${fmtKwh(agg.importKwh)}.`,
    },
  };
}

// ─── Page ────────────────────────────────────────────────────────────────

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const period = asPeriod(params.p);
  const anchor = parseAnchor(period, asAnchor(params.d));
  const range: Range = rangeFor(period, anchor);
  const isLiveView = period === "today" && range.isCurrent;

  const prevRange = isLiveView ? null : rangeFor(period, range.prevAnchor);

  const [shelly, marstek, settings, heartbeats, prevShelly, prevMarstek] = await Promise.all([
    fetchShellyRange(range.from, range.to),
    fetchMarstekRange(range.from, range.to),
    fetchUserSettings(),
    fetchHeartbeats(),
    prevRange ? fetchShellyRange(prevRange.from, prevRange.to) : Promise.resolve(null),
    prevRange ? fetchMarstekRange(prevRange.from, prevRange.to) : Promise.resolve(null),
  ]);

  const periodAgg = computePeriodAggregates(shelly, marstek, settings);
  const prevAgg =
    prevShelly && prevMarstek
      ? computePeriodAggregates(prevShelly, prevMarstek, settings)
      : null;

  let live: LiveState | null = null;
  let lastUpdate: string | null = null;
  if (isLiveView) {
    const [latestShelly, latestMarstek] = await Promise.all([
      fetchLatestShelly(),
      fetchLatestMarstek(),
    ]);
    live = deriveLive(latestShelly, latestMarstek, latestMarstek?.raw ?? null);
    lastUpdate =
      [latestShelly?.ts, latestMarstek?.ts]
        .filter((x): x is string => Boolean(x))
        .sort()
        .reverse()[0] ?? null;
  }

  const diagram = isLiveView && live
    ? buildLiveDiagram(live, periodAgg)
    : buildAggregateDiagram(periodAgg, prevAgg, period);

  const allPoints = mergeTimeSeries(shelly, marstek);
  const points = bucketTimeSeries(allPoints, BUCKET_MS[period]);
  const bands = dailySocBands(marstek);
  const health = classifyHealth(heartbeats);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      <AutoRefresh intervalSec={30} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">
            B2500 Energy
          </h1>
          {isLiveView && lastUpdate ? (
            <div className="mt-0.5 text-xs text-ink-500">
              Aktualisiert {formatRelative(lastUpdate)}
            </div>
          ) : null}
        </div>
        <PeriodSwitcher />
      </header>

      <div className="mt-3">
        <SystemStatus items={health} />
      </div>

      <div className="mt-5">
        <DateNavigator
          period={period}
          label={range.label}
          prevAnchorParam={rangeFor(period, range.prevAnchor).anchorParam}
          nextAnchorParam={rangeFor(period, range.nextAnchor).anchorParam}
          hasNext={range.hasNext}
          isCurrent={range.isCurrent}
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardLabel>{isLiveView ? "Energiefluss jetzt" : `Energiefluss ${range.shortLabel}`}</CardLabel>
        </CardHeader>
        <CardBody>
          <FlowDiagram
            modules={diagram.modules}
            flows={diagram.flows}
            tooltips={diagram.tooltips}
          />
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardLabel>
            {period === "today" ? "Verlauf" : period === "week" ? "Wochenverlauf (1h-Buckets)" : "Monatsverlauf (4h-Buckets)"}
          </CardLabel>
        </CardHeader>
        <CardBody>
          <MainChart points={points} />
          <div className="mt-3">
            <MainChartLegend />
          </div>
        </CardBody>
      </Card>

      {period !== "today" ? (
        <Card className="mt-4">
          <CardHeader>
            <CardLabel>Speicher SOC (Tages-Min/Max)</CardLabel>
          </CardHeader>
          <CardBody>
            <SocChartBands bands={bands} />
          </CardBody>
        </Card>
      ) : null}

      <div className="mt-4">
        <BalanceSummary agg={periodAgg} period={period} />
      </div>

      <TariffFooter settings={settings} />
    </main>
  );
}
