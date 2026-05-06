"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  title?: string;
  formula?: string;
  description?: string;
};

type Position = "left" | "center" | "right";

const TOOLTIP_HALF_WIDTH = 120; // half of 240px
const VIEWPORT_PADDING = 12;

export function InfoTooltip({ title, formula, description }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>("center");
  const wrapperRef = useRef<HTMLSpanElement>(null);

  // Recompute viewport-anchored position whenever opening
  useEffect(() => {
    if (!open || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const fromLeft = center;
    const fromRight = window.innerWidth - center;
    if (fromLeft < TOOLTIP_HALF_WIDTH + VIEWPORT_PADDING) setPosition("left");
    else if (fromRight < TOOLTIP_HALF_WIDTH + VIEWPORT_PADDING) setPosition("right");
    else setPosition("center");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const positionClass =
    position === "left"
      ? "left-0"
      : position === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <span ref={wrapperRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
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
            className={cn(
              "absolute top-full z-30 mt-2 w-[240px] max-w-[calc(100vw-24px)]",
              positionClass,
            )}
          >
            <div className="rounded-xl bg-ink-900 px-3 py-2 text-left text-xs leading-snug text-white shadow-lg">
              {title ? <div className="font-semibold">{title}</div> : null}
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
