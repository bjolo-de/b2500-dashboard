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

// ─── Display formatting ────────────────────────────────────────────────────

function fmtW(w: number | null): string {
  if (w == null) return "—";
  if (Math.abs(w) < 1000) return `${Math.round(w)} W`;
  return `${(w / 1000).toFixed(1)} kW`;
}
function fmtKwh(kwh: number, digits = 2): string {
  return `${kwh.toFixed(digits)} kWh`;
}
function fmtSignedW(w: number | null): string {
  if (w == null) return "—";
  const sign = w > 0 ? "+" : w < 0 ? "−" : "";
  return `${sign}${fmtW(Math.abs(w))}`;
}

// ─── Diagram input builder ────────────────────────────────────────────────
// Live mode (current day): use watts + today aggregate
// Aggregate mode: use kWh totals from period aggregates

const SCALE_KWH: Record<Period, number> = {
  today: 5,
  week: 30,
  month: 120,
};

function buildLiveDiagram(
  live: LiveState,
  todayAgg: PeriodAggregates,
  period: Period,
): {
  modules: { pv: ModuleSpec; battery: ModuleSpec; home: ModuleSpec; grid: ModuleSpec };
  flows: { pvHome: FlowSpec; pvBattery: FlowSpec; batteryHome: FlowSpec; homeGrid: FlowSpec };
  tooltips: Record<"pvHome" | "pvBattery" | "batteryHome" | "homeGrid", string>;
} {
  const wScale = 800;
  const intW = (w: number) => Math.min(1, w / wScale);

  const exporting = (live.saldoW ?? 0) < 0;
  const importing = (live.saldoW ?? 0) > 0;

  return {
    modules: {
      pv: {
        big: fmtW(live.pvW),
        small: fmtKwh(todayAgg.pvProducedKwh),
        highlighted: (live.pvW ?? 0) > 1,
      },
      battery: {
        big: live.socPct != null ? `${live.socPct} %` : "—",
        small:
          live.storedWh != null
            ? `${(live.storedWh / 1000).toFixed(2)} / ${(BATTERY_CAPACITY_WH_CONST / 1000).toFixed(2)} kWh`
            : undefined,
        highlighted: Math.abs(live.batteryFlowW ?? 0) > 1,
      },
      home: {
        big: fmtW(live.consumptionW),
        small: fmtKwh(todayAgg.consumptionKwh),
        highlighted: (live.consumptionW ?? 0) > 1,
      },
      grid: {
        big: fmtSignedW(live.saldoW),
        small: `${todayAgg.importKwh.toFixed(2)} kWh Bezug · ${todayAgg.exportKwh.toFixed(2)} kWh Einsp.`,
        highlighted: Math.abs(live.saldoW ?? 0) > 1,
        variant: exporting ? "export" : importing ? "import" : "idle",
      },
    },
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
        intensity: intW(Math.abs(live.saldoW ?? 0)),
        label: Math.abs(live.saldoW ?? 0) >= 1 ? fmtW(Math.abs(live.saldoW ?? 0)) : "",
        direction: exporting ? "export" : importing ? "import" : "idle",
      },
    },
    tooltips: {
      pvHome: "PV-Energie, die direkt von der Wohnung verbraucht wird (nicht über den Speicher).",
      pvBattery: "PV-Überschuss, der in den Speicher fließt zur späteren Nutzung.",
      batteryHome: "Speicher entlädt sich und versorgt die Wohnung.",
      homeGrid: exporting
        ? "Überschuss, der ins öffentliche Netz eingespeist wird."
        : importing
          ? "Energie, die aus dem öffentlichen Netz bezogen wird."
          : "Aktuell keine Bewegung im Netz-Pfad.",
    },
  };
}

function buildAggregateDiagram(
  agg: PeriodAggregates,
  period: Period,
  rangeLabel: string,
) {
  const scale = SCALE_KWH[period];
  const intK = (kwh: number) => Math.min(1, kwh / scale);
  const netKwh = agg.exportKwh - agg.importKwh; // + = export-net, - = import-net
  const exporting = netKwh > 0.001;
  const importing = netKwh < -0.001;

  // Battery card big: discharged kWh (energy delivered from battery into home)
  // — this is the tangible output number that pairs symmetrically with PV/Wohnung/Netz totals
  const dischargedKwh = agg.batteryDischargedKwh;
  const chargedKwh = agg.batteryChargedKwh;

  return {
    modules: {
      pv: {
        big: fmtKwh(agg.pvProducedKwh),
        small: rangeLabel,
        highlighted: agg.pvProducedKwh > 0.01,
      },
      battery: {
        big: `↑ ${chargedKwh.toFixed(2)}  ↓ ${dischargedKwh.toFixed(2)} kWh`,
        small:
          agg.socMinPct != null
            ? `SOC ${agg.socMinPct}–${agg.socMaxPct} %`
            : undefined,
        highlighted: chargedKwh + dischargedKwh > 0.01,
      },
      home: {
        big: fmtKwh(agg.consumptionKwh),
        small: rangeLabel,
        highlighted: agg.consumptionKwh > 0.01,
      },
      grid: {
        big: `${netKwh > 0 ? "+" : netKwh < 0 ? "−" : ""}${Math.abs(netKwh).toFixed(2)} kWh`,
        small: `${agg.importKwh.toFixed(2)} kWh Bezug · ${agg.exportKwh.toFixed(2)} kWh Einsp.`,
        highlighted: agg.importKwh + agg.exportKwh > 0.01,
        variant: (exporting ? "export" : importing ? "import" : "idle") as "export" | "import" | "idle",
      },
    },
    flows: {
      pvHome: {
        intensity: intK(agg.pvToHomeKwh),
        label: agg.pvToHomeKwh >= 0.01 ? fmtKwh(agg.pvToHomeKwh) : "",
      },
      pvBattery: {
        intensity: intK(agg.pvToBatteryKwh),
        label: agg.pvToBatteryKwh >= 0.01 ? fmtKwh(agg.pvToBatteryKwh) : "",
      },
      batteryHome: {
        intensity: intK(agg.batteryToHomeKwh),
        label: agg.batteryToHomeKwh >= 0.01 ? fmtKwh(agg.batteryToHomeKwh) : "",
      },
      homeGrid: {
        intensity: intK(Math.max(agg.exportKwh, agg.importKwh)),
        label:
          agg.exportKwh + agg.importKwh >= 0.01
            ? `${exporting ? "↑" : "↓"} ${Math.abs(netKwh).toFixed(2)} kWh`
            : "",
        direction: (exporting ? "export" : importing ? "import" : "idle") as "export" | "import" | "idle",
      },
    },
    tooltips: {
      pvHome: `Direkt verbrauchte PV-Energie ${rangeLabel}: ${fmtKwh(agg.pvToHomeKwh)}.`,
      pvBattery: `In den Speicher geflossene PV-Energie ${rangeLabel}: ${fmtKwh(agg.pvToBatteryKwh)}.`,
      batteryHome: `Vom Speicher in die Wohnung gelieferte Energie ${rangeLabel}: ${fmtKwh(agg.batteryToHomeKwh)}.`,
      homeGrid:
        exporting
          ? `Überschuss ins Netz eingespeist ${rangeLabel}: ${fmtKwh(agg.exportKwh)}.`
          : importing
            ? `Aus dem Netz bezogen ${rangeLabel}: ${fmtKwh(agg.importKwh)}.`
            : `Keine nennenswerte Netz-Bewegung ${rangeLabel}.`,
    },
  };
}

// ─── Page ────────────────────────────────────────────────────────────────

const BUCKET_MS: Record<Period, number> = {
  today: 0,                        // raw 60s samples
  week:  60 * 60 * 1000,           // 1h
  month: 4 * 60 * 60 * 1000,       // 4h
};

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

  const [shelly, marstek, settings, heartbeats] = await Promise.all([
    fetchShellyRange(range.from, range.to),
    fetchMarstekRange(range.from, range.to),
    fetchUserSettings(),
    fetchHeartbeats(),
  ]);

  const periodAgg = computePeriodAggregates(shelly, marstek, settings);

  // Live-mode extras: only when viewing the current "today"
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

  // Diagram input
  const diagram = isLiveView && live
    ? buildLiveDiagram(live, periodAgg, period)
    : buildAggregateDiagram(periodAgg, period, range.shortLabel);

  // Chart series
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
          <CardLabel>{isLiveView ? "Energiefluss jetzt" : "Energiefluss " + range.shortLabel}</CardLabel>
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
