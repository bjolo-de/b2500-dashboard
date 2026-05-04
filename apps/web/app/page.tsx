import {
  fetchHeartbeats,
  fetchLatestMarstek,
  fetchLatestShelly,
  fetchMarstekReadings,
  fetchShellyReadings,
  fetchUserSettings,
  type Period,
} from "@/lib/queries";
import {
  BATTERY_CAPACITY_WH_CONST,
  computePeriodAggregates,
  deriveLive,
} from "@/lib/aggregates";
import { classifyHealth } from "@/lib/system-health";
import { mergeTimeSeries, dailySocBands } from "@/lib/timeseries";
import { formatRelative } from "@/lib/format";
import { Card, CardBody, CardHeader, CardLabel } from "@/components/ui/card";
import { PeriodSwitcher } from "@/components/period-switcher";
import { SystemStatus } from "@/components/system-status";
import { FlowDiagram } from "@/components/flow-diagram";
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

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const period = asPeriod(params.p);

  const [
    shelly,
    marstek,
    latestShelly,
    latestMarstek,
    heartbeats,
    settings,
    todayShelly,
    todayMarstek,
  ] = await Promise.all([
    fetchShellyReadings(period),
    fetchMarstekReadings(period),
    fetchLatestShelly(),
    fetchLatestMarstek(),
    fetchHeartbeats(),
    fetchUserSettings(),
    period === "today" ? Promise.resolve(null) : fetchShellyReadings("today"),
    period === "today" ? Promise.resolve(null) : fetchMarstekReadings("today"),
  ]);

  const live = deriveLive(latestShelly, latestMarstek, latestMarstek?.raw ?? null);
  const points = mergeTimeSeries(shelly, marstek);
  const bands = dailySocBands(marstek);
  const periodAgg = computePeriodAggregates(shelly, marstek, settings);
  const todayAgg =
    period === "today"
      ? periodAgg
      : computePeriodAggregates(todayShelly!, todayMarstek!, settings);

  const health = classifyHealth(heartbeats);

  const lastUpdate =
    [latestShelly?.ts, latestMarstek?.ts]
      .filter((x): x is string => Boolean(x))
      .sort()
      .reverse()[0] ?? null;

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

      <Card className="mt-6">
        <CardHeader>
          <CardLabel>Energiefluss jetzt</CardLabel>
        </CardHeader>
        <CardBody>
          <FlowDiagram
            live={live}
            pvTodayKwh={todayAgg.pvProducedKwh}
            consumptionTodayKwh={todayAgg.consumptionKwh}
            importTodayKwh={todayAgg.importKwh}
            exportTodayKwh={todayAgg.exportKwh}
            storedCapacityWh={BATTERY_CAPACITY_WH_CONST}
          />
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardLabel>
            {period === "today"
              ? "Heutiger Verlauf"
              : period === "week"
                ? "Letzte 7 Tage"
                : "Letzter Monat"}
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
