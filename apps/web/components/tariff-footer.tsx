"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatNumber2 } from "@/lib/format";
import type { UserSettings } from "@/lib/queries";

type Props = {
  settings: UserSettings;
};

export function TariffFooter({ settings }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "mx-auto mt-8 block text-center text-xs text-ink-400 transition-colors hover:text-ink-700",
          "underline-offset-4 hover:underline",
        )}
      >
        Tarif {formatNumber2(Number(settings.energy_price_ct_kwh))} ct/kWh ·
        Grundgebühr {formatNumber2(Number(settings.base_fee_eur_month))} €/Monat
        {Number(settings.feed_in_ct_kwh) > 0
          ? ` · Einspeisung ${formatNumber2(Number(settings.feed_in_ct_kwh))} ct/kWh`
          : ""}
      </button>
      <AnimatePresence>
        {open && <TariffSheet settings={settings} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

function TariffSheet({
  settings,
  onClose,
}: {
  settings: UserSettings;
  onClose: () => void;
}) {
  const router = useRouter();
  const [energy, setEnergy] = useState(String(settings.energy_price_ct_kwh));
  const [base, setBase] = useState(String(settings.base_fee_eur_month));
  const [feedIn, setFeedIn] = useState(String(settings.feed_in_ct_kwh));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          energy_price_ct_kwh: energy,
          base_fee_eur_month: base,
          feed_in_ct_kwh: feedIn,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      onClose();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold text-ink-900">Tarif anpassen</div>
        <div className="mt-1 text-xs text-ink-500">
          Diese Werte werden für Eigenverbrauch- und Einsparungs-Berechnungen verwendet.
        </div>

        <div className="mt-4 space-y-3">
          <Field
            label="Arbeitspreis"
            unit="ct/kWh"
            value={energy}
            onChange={setEnergy}
          />
          <Field
            label="Grundgebühr"
            unit="€/Monat"
            value={base}
            onChange={setBase}
          />
          <Field
            label="Einspeisevergütung"
            unit="ct/kWh"
            value={feedIn}
            onChange={setFeedIn}
            help="0 lassen, wenn keine vorhanden"
          />
        </div>

        {err ? (
          <div className="mt-3 rounded-lg bg-alert-soft px-3 py-2 text-xs text-alert">
            {err}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
          >
            Abbrechen
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
          >
            {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({
  label,
  unit,
  value,
  onChange,
  help,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  help?: string;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-ink-700">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-mono tabular-nums",
            "focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-300/40",
          )}
        />
        <span className="text-xs text-ink-500 whitespace-nowrap">{unit}</span>
      </div>
      {help ? <div className="mt-1 text-[11px] text-ink-500">{help}</div> : null}
    </label>
  );
}
