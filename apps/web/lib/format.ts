// Number/date formatters used across the dashboard.
// All locale-set to de-DE for consistent decimal commas and 24h time.

const intl = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 0,
});

const intl1 = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const intl2 = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatW(w: number | null | undefined): string {
  if (w == null) return "—";
  if (Math.abs(w) < 1000) return `${intl.format(w)} W`;
  return `${intl1.format(w / 1000)} kW`;
}

export function formatWh(wh: number | null | undefined): string {
  if (wh == null) return "—";
  if (Math.abs(wh) < 1000) return `${intl.format(wh)} Wh`;
  return `${intl2.format(wh / 1000)} kWh`;
}

export function formatKwh(kwh: number | null | undefined): string {
  if (kwh == null) return "—";
  return `${intl2.format(kwh)} kWh`;
}

export function formatNumber2(v: number | null | undefined): string {
  if (v == null) return "—";
  return intl2.format(v);
}

export function formatPercent(p: number | null | undefined): string {
  if (p == null) return "—";
  return `${intl.format(p)} %`;
}

export function formatEur(eur: number | null | undefined): string {
  if (eur == null) return "—";
  return `${intl2.format(eur)} €`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `vor ${diffSec} s`;
  if (diffSec < 3600) return `vor ${Math.round(diffSec / 60)} min`;
  if (diffSec < 86400) return `vor ${Math.round(diffSec / 3600)} h`;
  return d.toLocaleDateString("de-DE");
}
