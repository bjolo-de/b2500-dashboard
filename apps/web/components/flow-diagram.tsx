"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Sun, BatteryMedium, Home, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const COLORS = {
  pv: "#10b981",
  battery: "#f97316",
  gridExport: "#3b82f6",
  gridImport: "#dc2626",
  home: "#71717a",
  inactive: "#d4d4d8",
};

// Visibility thresholds expressed in normalised intensity (0..1)
const T_VISIBLE = 0.0015;
const T_DOTS    = 0.040;

// ─── Layout geometry helpers ──────────────────────────────────────────────

type Card = { x: number; y: number; w: number; h: number };
type Cards = { pv: Card; battery: Card; home: Card; grid: Card };
type Anchor = "start" | "middle" | "end";
type LabelPos = { x: number; y: number; anchor: Anchor };
type Paths = Record<FlowKey, string>;
type Labels = Record<FlowKey, LabelPos>;
type Total = { W: number; H: number };
type FlowKey = "pvHome" | "pvBattery" | "batteryHome" | "homeGrid";

function anchors(c: Cards) {
  return {
    pvBottom:     { x: c.pv.x + c.pv.w / 2,         y: c.pv.y + c.pv.h },
    pvRight:      { x: c.pv.x + c.pv.w,             y: c.pv.y + c.pv.h / 2 },
    batteryTop:   { x: c.battery.x + c.battery.w / 2, y: c.battery.y },
    batteryRight: { x: c.battery.x + c.battery.w,   y: c.battery.y + c.battery.h / 2 },
    batteryLeft:  { x: c.battery.x,                  y: c.battery.y + c.battery.h / 2 },
    homeTop:      { x: c.home.x + c.home.w / 2,     y: c.home.y },
    homeLeft:     { x: c.home.x,                     y: c.home.y + c.home.h / 2 },
    homeRight:    { x: c.home.x + c.home.w,         y: c.home.y + c.home.h / 2 },
    homeBottom:   { x: c.home.x + c.home.w / 2,     y: c.home.y + c.home.h },
    gridLeft:     { x: c.grid.x,                     y: c.grid.y + c.grid.h / 2 },
    gridTop:      { x: c.grid.x + c.grid.w / 2,     y: c.grid.y },
  };
}

const DESKTOP: Total & { cards: Cards } = {
  W: 720, H: 320,
  cards: {
    pv:      { x: 20,             y: (320 - 100) / 2, w: 170, h: 100 },
    home:    { x: (720 - 170) / 2, y: 20,             w: 170, h: 100 },
    battery: { x: (720 - 170) / 2, y: 320 - 20 - 100, w: 170, h: 100 },
    grid:    { x: 720 - 20 - 170, y: (320 - 100) / 2, w: 170, h: 100 },
  },
};
const DA = anchors(DESKTOP.cards);
const DESKTOP_PATHS: Paths = {
  pvHome:      `M ${DA.pvRight.x} ${DA.pvRight.y} Q ${(DA.pvRight.x + DA.homeLeft.x) / 2} ${DA.homeLeft.y}, ${DA.homeLeft.x} ${DA.homeLeft.y}`,
  pvBattery:   `M ${DA.pvRight.x} ${DA.pvRight.y} Q ${(DA.pvRight.x + DA.batteryLeft.x) / 2} ${DA.batteryLeft.y}, ${DA.batteryLeft.x} ${DA.batteryLeft.y}`,
  batteryHome: `M ${DA.batteryTop.x} ${DA.batteryTop.y} L ${DA.homeBottom.x} ${DA.homeBottom.y}`,
  homeGrid:    `M ${DA.homeRight.x} ${DA.homeRight.y} Q ${(DA.homeRight.x + DA.gridLeft.x) / 2} ${DA.gridLeft.y}, ${DA.gridLeft.x} ${DA.gridLeft.y}`,
};
const DESKTOP_LABELS: Labels = {
  pvHome:      { x: (DA.pvRight.x + DA.homeLeft.x) / 2,    y: (DA.pvRight.y + DA.homeLeft.y) / 2 - 12, anchor: "middle" },
  pvBattery:   { x: (DA.pvRight.x + DA.batteryLeft.x) / 2, y: (DA.pvRight.y + DA.batteryLeft.y) / 2 + 16, anchor: "middle" },
  batteryHome: { x: DA.batteryTop.x + 14,                  y: (DA.batteryTop.y + DA.homeBottom.y) / 2, anchor: "start" },
  homeGrid:    { x: (DA.homeRight.x + DA.gridLeft.x) / 2,  y: (DA.homeRight.y + DA.gridLeft.y) / 2 - 12, anchor: "middle" },
};

const MOBILE: Total & { cards: Cards } = {
  W: 360, H: 500,
  cards: {
    pv:      { x: 100, y: 20,  w: 160, h: 88 },
    battery: { x: 20,  y: 196, w: 140, h: 88 },
    home:    { x: 200, y: 196, w: 140, h: 88 },
    grid:    { x: 100, y: 372, w: 160, h: 88 },
  },
};
const MA = anchors(MOBILE.cards);
const MOBILE_PATHS: Paths = {
  pvBattery:   `M ${MA.pvBottom.x} ${MA.pvBottom.y} Q ${MA.pvBottom.x - 30} ${(MA.pvBottom.y + MA.batteryTop.y) / 2}, ${MA.batteryTop.x} ${MA.batteryTop.y}`,
  pvHome:      `M ${MA.pvBottom.x} ${MA.pvBottom.y} Q ${MA.pvBottom.x + 30} ${(MA.pvBottom.y + MA.homeTop.y) / 2}, ${MA.homeTop.x} ${MA.homeTop.y}`,
  batteryHome: `M ${MA.batteryRight.x} ${MA.batteryRight.y} L ${MA.homeLeft.x} ${MA.homeLeft.y}`,
  homeGrid:    `M ${MA.homeBottom.x} ${MA.homeBottom.y} Q ${MA.homeBottom.x - 20} ${(MA.homeBottom.y + MA.gridTop.y) / 2}, ${MA.gridTop.x} ${MA.gridTop.y}`,
};
const MOBILE_LABELS: Labels = {
  pvBattery:   { x: MA.batteryTop.x + 26, y: (MA.pvBottom.y + MA.batteryTop.y) / 2 - 8, anchor: "start" },
  pvHome:      { x: MA.homeTop.x - 26,    y: (MA.pvBottom.y + MA.homeTop.y) / 2 - 8,    anchor: "end" },
  batteryHome: { x: (MA.batteryRight.x + MA.homeLeft.x) / 2, y: MA.batteryRight.y - 12, anchor: "middle" },
  homeGrid:    { x: MA.homeBottom.x - 26, y: (MA.homeBottom.y + MA.gridTop.y) / 2,      anchor: "end" },
};

function strokeWidth(intensity: number) {
  return Math.max(1.4, Math.min(5.5, 1 + intensity * 5));
}
function dotCount(intensity: number) {
  if (intensity < T_DOTS) return 0;
  if (intensity < 0.25)   return 1;
  if (intensity < 0.625)  return 2;
  return 3;
}

// ─── Public API types ────────────────────────────────────────────────────

export type ModuleSpec = {
  big: string;
  small?: string;
  highlighted: boolean;
  /** Only used for the Netz card: "import"|"export"|"idle" controls accent color. */
  variant?: "import" | "export" | "idle";
};

export type FlowSpec = {
  intensity: number;
  label: string;
  /** For homeGrid: "import" reverses dot direction. */
  direction?: "export" | "import" | "idle";
};

type Props = {
  modules: { pv: ModuleSpec; battery: ModuleSpec; home: ModuleSpec; grid: ModuleSpec };
  flows: {
    pvHome: FlowSpec;
    pvBattery: FlowSpec;
    batteryHome: FlowSpec;
    homeGrid: FlowSpec;
  };
  tooltips: Record<FlowKey, string>;
};

// ─── Components ──────────────────────────────────────────────────────────

function FlowArc({
  d,
  flow,
  color,
  reduceMotion,
  labelPos,
  duration = 2.5,
  onActivate,
  isActive,
}: {
  d: string;
  flow: FlowSpec;
  color: string;
  reduceMotion: boolean;
  labelPos: LabelPos;
  duration?: number;
  onActivate: () => void;
  isActive: boolean;
}) {
  const visible = flow.intensity >= T_VISIBLE;
  const sw = visible ? strokeWidth(flow.intensity) : 1.2;
  const stroke = visible ? color : COLORS.inactive;
  const dots = visible && !reduceMotion ? dotCount(flow.intensity) : 0;
  const reverse = flow.direction === "import";
  return (
    <g style={{ cursor: "pointer" }} onClick={onActivate} onMouseEnter={onActivate}>
      <path d={d} stroke={stroke} strokeWidth={sw} strokeLinecap="round" fill="none" opacity={visible ? 1 : 0.55} />
      <path d={d} stroke="transparent" strokeWidth={28} strokeLinecap="round" fill="none" pointerEvents="stroke" />
      {dots > 0
        ? Array.from({ length: dots }).map((_, i) => (
            <circle key={i} r={Math.max(2.4, sw * 0.95)} fill={color}>
              <animateMotion
                dur={`${duration}s`}
                repeatCount="indefinite"
                begin={`${(i * duration) / dots}s`}
                path={d}
                keyPoints={reverse ? "1;0" : "0;1"}
                keyTimes="0;1"
              />
            </circle>
          ))
        : null}
      {visible && flow.label ? (
        <g pointerEvents="none">
          <rect
            x={labelPos.anchor === "middle" ? labelPos.x - 28 : labelPos.anchor === "start" ? labelPos.x - 4 : labelPos.x - 52}
            y={labelPos.y - 11}
            width={56}
            height={20}
            rx={6}
            fill="white"
            opacity={0.96}
            stroke={isActive ? color : "#e4e4e7"}
            strokeWidth={isActive ? 1.5 : 0.5}
          />
          <text
            x={labelPos.x}
            y={labelPos.y + 1}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize="11"
            fontWeight="600"
            fill={color}
            textAnchor={labelPos.anchor}
            dominantBaseline="middle"
          >
            {flow.label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function NodeCard({
  className,
  style,
  icon,
  label,
  spec,
  accentColor,
  compact = false,
}: {
  className?: string;
  style?: React.CSSProperties;
  icon: React.ReactNode;
  label: string;
  spec: ModuleSpec;
  accentColor: string;
  compact?: boolean;
}) {
  return (
    <motion.div
      className={cn("rounded-2xl border bg-white border-ink-200/60 overflow-hidden", compact ? "p-2.5" : "p-3", "shadow-card", className)}
      style={style}
      animate={{
        boxShadow: spec.highlighted
          ? `0 4px 14px ${accentColor}33, 0 0 0 1px ${accentColor}40`
          : "0 1px 3px rgba(0,0,0,0.06)",
      }}
      transition={{ duration: 0.6 }}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn("flex shrink-0 items-center justify-center rounded-lg", compact ? "h-6 w-6" : "h-7 w-7")}
          style={{ background: `${accentColor}15`, color: accentColor }}
        >
          {icon}
        </div>
        <span className={cn("font-medium uppercase tracking-wide text-ink-500", compact ? "text-[11px]" : "text-xs")}>
          {label}
        </span>
      </div>
      <div
        className={cn("mt-1 font-mono font-semibold tabular-nums leading-tight", compact ? "text-base" : "text-lg")}
        style={{ color: spec.highlighted ? accentColor : "#18181b" }}
      >
        {spec.big}
      </div>
      {spec.small ? (
        <div className="mt-0.5 text-[11px] leading-tight text-ink-500">{spec.small}</div>
      ) : null}
    </motion.div>
  );
}

export function FlowDiagram({ modules, flows, tooltips }: Props) {
  const reduceMotion = useReducedMotion() ?? false;
  const [activeFlow, setActiveFlow] = useState<FlowKey | null>(null);

  useEffect(() => {
    if (activeFlow == null) return;
    const t = setTimeout(() => setActiveFlow(null), 4500);
    return () => clearTimeout(t);
  }, [activeFlow]);

  const gridColor =
    flows.homeGrid.direction === "export"
      ? COLORS.gridExport
      : flows.homeGrid.direction === "import"
        ? COLORS.gridImport
        : COLORS.inactive;
  const gridAccent =
    modules.grid.variant === "export"
      ? COLORS.gridExport
      : modules.grid.variant === "import"
        ? COLORS.gridImport
        : COLORS.home;

  const cardStyle = (c: Card, total: Total) =>
    ({
      position: "absolute",
      left: `${(c.x / total.W) * 100}%`,
      top: `${(c.y / total.H) * 100}%`,
      width: `${(c.w / total.W) * 100}%`,
      height: `${(c.h / total.H) * 100}%`,
    }) as React.CSSProperties;

  const renderArcs = (paths: Paths, labels: Labels) => (
    <>
      <FlowArc d={paths.pvHome}      flow={flows.pvHome}      color={COLORS.pv}      reduceMotion={reduceMotion} labelPos={labels.pvHome}      onActivate={() => setActiveFlow("pvHome")}      isActive={activeFlow === "pvHome"} />
      <FlowArc d={paths.pvBattery}   flow={flows.pvBattery}   color={COLORS.pv}      reduceMotion={reduceMotion} labelPos={labels.pvBattery}   onActivate={() => setActiveFlow("pvBattery")}   isActive={activeFlow === "pvBattery"} duration={3} />
      <FlowArc d={paths.batteryHome} flow={flows.batteryHome} color={COLORS.battery} reduceMotion={reduceMotion} labelPos={labels.batteryHome} onActivate={() => setActiveFlow("batteryHome")} isActive={activeFlow === "batteryHome"} />
      <FlowArc d={paths.homeGrid}    flow={flows.homeGrid}    color={gridColor}      reduceMotion={reduceMotion} labelPos={labels.homeGrid}    onActivate={() => setActiveFlow("homeGrid")}    isActive={activeFlow === "homeGrid"} />
    </>
  );

  const renderCards = (cards: Cards, total: Total, compact: boolean) => (
    <>
      <NodeCard style={cardStyle(cards.pv, total)}      icon={<Sun size={compact ? 14 : 16} strokeWidth={2.2} />}           label="PV"       spec={modules.pv}      accentColor={COLORS.pv}      compact={compact} />
      <NodeCard style={cardStyle(cards.home, total)}    icon={<Home size={compact ? 14 : 16} strokeWidth={2.2} />}          label="Wohnung"  spec={modules.home}    accentColor={COLORS.home}    compact={compact} />
      <NodeCard style={cardStyle(cards.battery, total)} icon={<BatteryMedium size={compact ? 14 : 16} strokeWidth={2.2} />} label="Speicher" spec={modules.battery} accentColor={COLORS.battery} compact={compact} />
      <NodeCard style={cardStyle(cards.grid, total)}    icon={<Zap size={compact ? 14 : 16} strokeWidth={2.2} />}           label="Netz"     spec={modules.grid}    accentColor={gridAccent}     compact={compact} />
    </>
  );

  const tooltipFor = (key: FlowKey, labels: Labels, total: Total) => (
    <FlowTooltip
      x={labels[key].x}
      y={labels[key].y}
      total={total}
      text={tooltips[key]}
      onDismiss={() => setActiveFlow(null)}
    />
  );

  return (
    <div className="w-full">
      <div
        className="relative mx-auto hidden w-full sm:block"
        style={{ aspectRatio: `${DESKTOP.W} / ${DESKTOP.H}`, maxWidth: 760 }}
        onClick={(e) => { if (e.target === e.currentTarget) setActiveFlow(null); }}
      >
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${DESKTOP.W} ${DESKTOP.H}`} preserveAspectRatio="xMidYMid meet">
          {renderArcs(DESKTOP_PATHS, DESKTOP_LABELS)}
        </svg>
        <AnimatePresence>{activeFlow ? tooltipFor(activeFlow, DESKTOP_LABELS, DESKTOP) : null}</AnimatePresence>
        {renderCards(DESKTOP.cards, DESKTOP, false)}
      </div>

      <div
        className="relative mx-auto block w-full sm:hidden"
        style={{ aspectRatio: `${MOBILE.W} / ${MOBILE.H}` }}
        onClick={(e) => { if (e.target === e.currentTarget) setActiveFlow(null); }}
      >
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${MOBILE.W} ${MOBILE.H}`} preserveAspectRatio="xMidYMid meet">
          {renderArcs(MOBILE_PATHS, MOBILE_LABELS)}
        </svg>
        <AnimatePresence>{activeFlow ? tooltipFor(activeFlow, MOBILE_LABELS, MOBILE) : null}</AnimatePresence>
        {renderCards(MOBILE.cards, MOBILE, true)}
      </div>
    </div>
  );
}

function FlowTooltip({
  x, y, total, text, onDismiss,
}: {
  x: number; y: number; total: Total; text: string; onDismiss: () => void;
}) {
  const left = `${(x / total.W) * 100}%`;
  const top = `${(y / total.H) * 100}%`;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      className="absolute z-10 max-w-[220px] -translate-x-1/2 -translate-y-full"
      style={{ left, top, marginTop: -16 }}
      onMouseLeave={onDismiss}
      onClick={(e) => { e.stopPropagation(); onDismiss(); }}
    >
      <div className="rounded-xl bg-ink-900 px-3 py-2 text-xs leading-snug text-white shadow-lg">{text}</div>
      <div className="mx-auto -mt-1 h-2 w-2 rotate-45 bg-ink-900" />
    </motion.div>
  );
}
