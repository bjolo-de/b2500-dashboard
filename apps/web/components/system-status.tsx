"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import type { ComponentHealth, Severity } from "@/lib/system-health";

const DOT_COLOR: Record<Severity, string> = {
  ok: "bg-pv",
  warn: "bg-battery",
  down: "bg-alert",
};

const PILL_COLOR: Record<Severity, string> = {
  ok: "text-ink-700 bg-white border-ink-200/60",
  warn: "text-battery bg-battery-soft border-battery/40",
  down: "text-alert bg-alert-soft border-alert/40",
};

export function SystemStatus({ items }: { items: ComponentHealth[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasIssue = items.some((i) => i.severity !== "ok");

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-sm"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-1.5">
          {items.map((i) => (
            <span
              key={i.key}
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                DOT_COLOR[i.severity],
                i.severity === "warn" && "animate-pulse",
              )}
              aria-label={`${i.label}: ${i.severity}`}
            />
          ))}
        </div>
        <span
          className={cn(
            "font-medium",
            hasIssue ? "text-alert" : "text-ink-600",
          )}
        >
          {hasIssue ? "System mit Hinweisen" : "System läuft"}
        </span>
        <svg
          className={cn(
            "h-3.5 w-3.5 text-ink-400 transition-transform",
            expanded && "rotate-180",
          )}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M3 4.5l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {expanded ? (
        <div className="mt-2 space-y-2">
          {items.map((i) => (
            <div
              key={i.key}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                PILL_COLOR[i.severity],
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      DOT_COLOR[i.severity],
                    )}
                  />
                  {i.label}
                </div>
                <div className="text-xs text-ink-500">
                  {i.lastSeen ? formatRelative(i.lastSeen) : "—"}
                </div>
              </div>
              {i.hint ? (
                <div className="mt-1 text-xs leading-relaxed">{i.hint}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
