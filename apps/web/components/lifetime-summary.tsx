import { Card, CardBody, CardHeader, CardLabel } from "./ui/card";
import { InfoTooltip } from "./info-tooltip";
import { formatEur, formatKwh } from "@/lib/format";
import type { LifetimeTotals } from "@/lib/aggregates";

// Lifetime stats live in exactly one place (the year tab) so the recurring
// period tabs stay lean.

const intl1 = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function fmtKg(kg: number): string {
  return `${intl1.format(kg)} kg`;
}

function fmtPct(pct: number): string {
  if (pct < 0.1) return "<0,1 %";
  return `${intl1.format(pct)} %`;
}

export function LifetimeSummary({ totals }: { totals: LifetimeTotals }) {
  return (
    <Card>
      <CardHeader>
        <CardLabel>Seit Aufzeichnungsbeginn</CardLabel>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Metric
            label="PV erzeugt"
            value={formatKwh(totals.pvProducedKwh)}
            color="text-pv"
          />
          <Metric
            label="Eingespart"
            value={formatEur(totals.savedEur)}
            color="text-pv"
            info={{
              title: "Eingesparte Stromkosten",
              formula: "(Verbrauch − Netz-Bezug) × Arbeitspreis",
              description:
                "Rechnungs-Differenz gegenüber einem Haushalt ohne PV-System, bewertet zum aktuellen Tarif.",
            }}
          />
          <Metric
            label="CO₂ vermieden"
            value={fmtKg(totals.co2SavedKg)}
            sub={`≈ ${fmtPct(totals.euFootprintPct)} des CO₂-Jahresausstoßes eines EU-Bürgers`}
            color="text-pv"
            info={{
              title: "Vermiedenes CO₂",
              formula: "PV erzeugt × 0,38 kg/kWh",
              description:
                "Deutscher Strommix (~380 g CO₂/kWh, UBA). Zum Vergleich: Ein EU-Bürger verursacht ~6,9 t CO₂ pro Jahr. S-Miles rechnet mit ~1 kg/kWh (Kohlestrom) und zeigt daher höhere Werte.",
            }}
          />
          <Metric
            label="Baum-Äquivalent"
            value={`${intl1.format(totals.treeYears)} Baum-Jahre`}
            color="text-pv"
            info={{
              title: "Baum-Äquivalent",
              formula: "CO₂ vermieden ÷ 21 kg",
              description:
                "Ein ausgewachsener Baum bindet etwa 21 kg CO₂ pro Jahr. Der Wert entspricht also der Jahresleistung so vieler Bäume.",
            }}
          />
        </div>
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
      {sub ? <div className="text-[11px] leading-snug text-ink-500">{sub}</div> : null}
    </div>
  );
}
