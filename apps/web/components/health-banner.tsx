import type { Heartbeat } from "@/lib/queries";
import { isComponentStale } from "@/lib/savings";
import { formatRelative } from "@/lib/format";

const COMPONENT_LABEL: Record<string, string> = {
  pico_bridge: "Pico-Bridge",
  shelly_script: "Shelly",
  forwarder: "MQTT-Forwarder",
};

export function HealthBanner({ heartbeats }: { heartbeats: Heartbeat[] }) {
  const stale = heartbeats.filter((h) => isComponentStale(h.last_seen));

  if (stale.length === 0) return null;

  return (
    <div className="rounded-xl border border-alert/30 bg-alert-soft px-4 py-3 text-sm text-alert">
      <div className="font-medium">
        {stale.length} Komponente{stale.length === 1 ? "" : "n"} senden keine
        Daten:
      </div>
      <ul className="mt-1 list-disc pl-4 text-alert/90">
        {stale.map((h) => (
          <li key={h.component}>
            {COMPONENT_LABEL[h.component] ?? h.component} — letztes Lebenszeichen{" "}
            {formatRelative(h.last_seen)}
          </li>
        ))}
      </ul>
    </div>
  );
}
