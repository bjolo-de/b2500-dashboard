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
import {
  AGGREGATE_PERIODS,
  parseAnchor,
  rangeFor,
  type AggregatePeriod,
  type Period,
  type Range,
} from "@/lib/period";
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

const VALID_PERIODS = new Set<Period>(["live", "today", "week", "month"]);

function asPeriod(s: string | string[] | undefined): Period {
  const v = Array.isArray(s) ? s[0] : s;
  return VALID_PERIODS.has(v as Period) ? (v as Period) : "live";
}
function asAnchor(s: string | string[] | undefined): string | undefined {
  return Array.isArray(s) ? s[0] : s;
}

const TREND_VS: Record<AggregatePeriod, string> = {
  today: "Vortag",
  week: "Vorwoche",
  month: "Vormonat",
};
const SCALE_KWH: Record<AggregatePeriod, number> = { today: 5, week: 15, month: 60 };
const BUCKET_MS: Record<AggregatePeriod, number> = {
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
function fmtCycles(c: number): string {
  if (c < 10) return c.toFixed(2).replace(".", ",");
  if (c < 100) return c.toFixed(1).replace(".", ",");
  return Math.round(c).toString();
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
      homeGrid: {
        intensity: intW(exportingW),
        label: exportingW >= 1 ? fmtW(exportingW) : "",
      },
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
  period: AggregatePeriod,
) {
  const scale = SCALE_KWH[period];
  const intK = (kwh: number) => Math.min(1, kwh / scale);
  const vs = TREND_VS[period];

  const netSaldoKwh = agg.importKwh - agg.exportKwh;
  const exporting = netSaldoKwh < -0.001;
  const importing = netSaldoKwh > 0.001;

  const tr = (cur: number, prv: number | null | undefined): Trend | undefined =>
    prv == null ? undefined : trendOf(cur, prv, vs);

  // Speicher: cycles = (charged + discharged) / (2 * capacity).
  const socRange =
    agg.socMinPct != null && agg.socMaxPct != null
      ? `${agg.socMinPct}–${agg.socMaxPct} % SOC`
      : undefined;

  return {
    modules: {
      pv: {
        big: fmtKwh(agg.pvProducedKwh),
        trend: tr(agg.pvProducedKwh, prev?.pvProducedKwh),
        highlighted: agg.pvProducedKwh > 0.01,
      },
      battery: {
        big: `${fmtCycles(agg.cyclesEquivalent)} Zyklen`,
        small: socRange,
        trend: tr(agg.cyclesEquivalent, prev?.cyclesEquivalent),
        highlighted: agg.cyclesEquivalent > 0.005,
      },
      home: {
        big: fmtKwh(agg.consumptionKwh),
        trend: tr(agg.consumptionKwh, prev?.consumptionKwh),
        highlighted: agg.consumptionKwh > 0.01,
      },
      grid: {
        big: fmtSignedKwh(netSaldoKwh),
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

  const [settings, heartbeats] = await Promise.all([
    fetchUserSettings(),
    fetchHeartbeats(),
  ]);
  const health = classifyHealth(heartbeats);

  // ─── Live tab: minimal page, only "right now" ────────────────────────────
  if (period === "live") {
    const todayRange = rangeFor("today", new Date());
    const [latestShelly, latestMarstek, todayShelly, todayMarstek] = await Promise.all([
      fetchLatestShelly(),
      fetchLatestMarstek(),
      fetchShellyRange(todayRange.from, todayRange.to),
      fetchMarstekRange(todayRange.from, todayRange.to),
    ]);
    const live = deriveLive(latestShelly, latestMarstek, latestMarstek?.raw ?? null);
    const todayAgg = computePeriodAggregates(todayShelly, todayMarstek, settings);
    const lastUpdate =
      [latestShelly?.ts, latestMarstek?.ts]
        .filter((x): x is string => Boolean(x))
        .sort()
        .reverse()[0] ?? null;

    const diagram = buildLiveDiagram(live, todayAgg);

    return (
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        <AutoRefresh intervalSec={30} />
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">
              B2500 Energy
            </h1>
            {lastUpdate ? (
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

        <Card className="mt-5">
          <CardHeader>
            <CardLabel>Energiefluss jetzt</CardLabel>
          </CardHeader>
          <CardBody>
            <FlowDiagram
              modules={diagram.modules}
              flows={diagram.flows}
              tooltips={diagram.tooltips}
            />
          </CardBody>
        </Card>

        <TariffFooter settings={settings} />
      </main>
    );
  }

  // ─── Aggregate tabs (today / week / month) ────────────────────────────────
  const aggPeriod = period as AggregatePeriod;
  const anchor = parseAnchor(aggPeriod, asAnchor(params.d));
  const range: Range = rangeFor(aggPeriod, anchor);

  // Previous-period range for trend. For current (in-progress) periods we
  // match elapsed time so the comparison is fair (e.g., today 09:00 vs
  // yesterday 00:00–09:00, not yesterday's full day).
  const fullPrev = rangeFor(aggPeriod, range.prevAnchor);
  const elapsedMs = range.isCurrent
    ? Math.min(
        Date.now() - range.from.getTime(),
        range.to.getTime() - range.from.getTime(),
      )
    : range.to.getTime() - range.from.getTime();
  const prevRange = {
    from: fullPrev.from,
    to: range.isCurrent
      ? new Date(fullPrev.from.getTime() + elapsedMs)
      : fullPrev.to,
  };

  const [shelly, marstek, prevShelly, prevMarstek] = await Promise.all([
    fetchShellyRange(range.from, range.to),
    fetchMarstekRange(range.from, range.to),
    fetchShellyRange(prevRange.from, prevRange.to),
    fetchMarstekRange(prevRange.from, prevRange.to),
  ]);

  const periodAgg = computePeriodAggregates(shelly, marstek, settings);
  const prevAgg = computePeriodAggregates(prevShelly, prevMarstek, settings);

  const diagram = buildAggregateDiagram(periodAgg, prevAgg, aggPeriod);

  const allPoints = mergeTimeSeries(shelly, marstek);
  const points = bucketTimeSeries(allPoints, BUCKET_MS[aggPeriod]);
  const bands = dailySocBands(marstek);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      <AutoRefresh intervalSec={30} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">
            B2500 Energy
          </h1>
        </div>
        <PeriodSwitcher />
      </header>

      <div className="mt-3">
        <SystemStatus items={health} />
      </div>

      <div className="mt-5">
        <DateNavigator
          period={aggPeriod}
          label={range.label}
          prevAnchorParam={rangeFor(aggPeriod, range.prevAnchor).anchorParam}
          nextAnchorParam={rangeFor(aggPeriod, range.nextAnchor).anchorParam}
          hasNext={range.hasNext}
          isCurrent={range.isCurrent}
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardLabel>Energiefluss {range.shortLabel}</CardLabel>
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
            {aggPeriod === "today" ? "Verlauf" : aggPeriod === "week" ? "Wochenverlauf (1h-Buckets)" : "Monatsverlauf (4h-Buckets)"}
          </CardLabel>
        </CardHeader>
        <CardBody>
          <MainChart points={points} />
          <div className="mt-3">
            <MainChartLegend />
          </div>
        </CardBody>
      </Card>

      {aggPeriod !== "today" ? (
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
        <BalanceSummary agg={periodAgg} period={aggPeriod} />
      </div>

      <TariffFooter settings={settings} />
    </main>
  );
}
