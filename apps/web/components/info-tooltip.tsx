"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info } from "lucide-react";

type Props = {
  title?: string;
  formula?: string;
  description?: string;
};

export function InfoTooltip({ title, formula, description }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-ink-400 transition-colors hover:text-ink-700"
        aria-label="Erklärung anzeigen"
      >
        <Info size={12} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            onMouseLeave={() => setOpen(false)}
            className="absolute left-1/2 top-full z-30 mt-2 w-[240px] -translate-x-1/2"
          >
            <div className="rounded-xl bg-ink-900 px-3 py-2 text-left text-xs leading-snug text-white shadow-lg">
              {title ? (
                <div className="font-semibold">{title}</div>
              ) : null}
              {formula ? (
                <div className="mt-1 font-mono text-[11px] text-white/85">
                  {formula}
                </div>
              ) : null}
              {description ? (
                <div className="mt-1 text-white/85">{description}</div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
