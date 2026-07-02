import { Card, CardBody, CardHeader, CardLabel } from "./ui/card";
import { InfoTooltip } from "./info-tooltip";
import { formatEur, formatKwh } from "@/lib/format";
import type { PeriodAggregates } from "@/lib/aggregates";

type Props = {
  agg: PeriodAggregates;
  /** Period the numbers cover, e.g. "heute", "KW 27 / 2026", "Juli 2026". */
  label: string;
};

export function BalanceSummary({ agg, label }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-3">
          <CardLabel className="truncate">Bilanz {label}</CardLabel>
          {agg.costAvoidedEur > 0 ? (
            <div className="shrink-0 text-xs text-ink-500">
              <span className="font-mono tabular-nums text-pv">
                {formatEur(agg.costAvoidedEur)}
              </span>{" "}
              eingespart
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Metric
            label="PV produziert"
            value={formatKwh(agg.pvProducedKwh)}
            color="text-pv"
          />
          <Metric
            label="Verbrauch"
            value={formatKwh(agg.consumptionKwh)}
          />
          <Metric
            label="Eigenverbrauch"
            value={
              agg.selfConsumptionPct != null
                ? `${Math.round(agg.selfConsumptionPct)} %`
                : "—"
            }
            color="text-pv"
            info={{
              title: "Eigenverbrauchsquote",
              formula: "(PV − Einspeisung) ÷ PV × 100",
              description:
                "Anteil deiner PV-Produktion, der nicht ins Netz floss, sondern direkt oder via Speicher in der Wohnung genutzt wurde.",
            }}
          />
          <Metric
            label="Autarkie"
            value={
              agg.autarkyPct != null
                ? `${Math.round(agg.autarkyPct)} %`
                : "—"
            }
            color="text-battery"
            info={{
              title: "Autarkiegrad",
              formula: "(Verbrauch − Bezug) ÷ Verbrauch × 100",
              description:
                "Anteil deines Strombedarfs, den du selbst gedeckt hast — über PV-Direktverbrauch und Speicher-Entladung.",
            }}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Metric
            label="Netz-Bezug"
            value={formatKwh(agg.importKwh)}
            sub={agg.costImportedEur > 0 ? formatEur(agg.costImportedEur) : undefined}
            color="text-alert"
          />
          <Metric
            label="Einspeisung"
            value={formatKwh(agg.exportKwh)}
            sub={agg.feedInRevenueEur > 0 ? formatEur(agg.feedInRevenueEur) : undefined}
            color="text-grid"
          />
          <Metric
            label="Speicher geladen"
            value={formatKwh(agg.batteryChargedKwh)}
            color="text-battery"
          />
          <Metric
            label="Speicher entladen"
            value={formatKwh(agg.batteryDischargedKwh)}
            color="text-battery"
          />
        </div>

        {agg.costWithoutSystemEur > 0 && agg.costAvoidedEur > 0 ? (
          <div className="mt-4 rounded-lg bg-pv-soft/40 px-3 py-2 text-xs text-ink-700">
            <span className="font-medium">Hochrechnung:</span> Ohne PV-System
            hättest du {formatEur(agg.costWithoutSystemEur)} bezahlt — durch
            den Eigenverbrauch waren es netto{" "}
            {formatEur(agg.costImportedEur)}.
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Metric({
  label,
  value,
  sub,
  color = "text-ink-900",
  info,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  info?: { title: string; formula?: string; description: string };
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center text-[11px] font-medium uppercase tracking-wide text-ink-500">
        <span className="truncate">{label}</span>
        {info ? (
          <InfoTooltip
            title={info.title}
            formula={info.formula}
            description={info.description}
          />
        ) : null}
      </div>
      <div className={`mt-0.5 font-mono text-base font-semibold tabular-nums ${color}`}>
        {value}
      </div>
      {sub ? <div className="text-[11px] text-ink-500">{sub}</div> : null}
    </div>
  );
}
