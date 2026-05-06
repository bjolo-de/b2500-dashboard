"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Sun, BatteryMedium, Home, Zap, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "./info-tooltip";

const COLORS = {
  pv: "#10b981",
  battery: "#f97316",
  gridExport: "#3b82f6",
  gridImport: "#dc2626",
  home: "#71717a",
  inactive: "#e4e4e7",
};

const T_VISIBLE = 0.0015;

// ─── Layout ──────────────────────────────────────────────────────────────

type Card = { x: number; y: number; w: number; h: number };
type Cards = { pv: Card; battery: Card; home: Card; grid: Card };
type Anchor = "start" | "middle" | "end";
type LabelPos = { x: number; y: number; anchor: Anchor };
type Total = { W: number; H: number };
type FlowKey = "pvHome" | "pvBattery" | "batteryHome" | "homeGrid" | "gridHome";
type Paths = Record<FlowKey, string>;
type Labels = Record<FlowKey, LabelPos>;

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
  W: 720, H: 340,
  cards: {
    pv:      { x: 20,             y: (340 - 110) / 2, w: 170, h: 110 },
    home:    { x: (720 - 170) / 2, y: 20,             w: 170, h: 110 },
    battery: { x: (720 - 170) / 2, y: 340 - 20 - 110, w: 170, h: 110 },
    grid:    { x: 720 - 20 - 170, y: (340 - 110) / 2, w: 170, h: 110 },
  },
};
const DA = anchors(DESKTOP.cards);
const D_HOME_RIGHT_X = DA.homeRight.x;
const D_GRID_LEFT_X = DA.gridLeft.x;
const D_HOME_TOP_Y = DESKTOP.cards.home.y;
const D_HOME_BOT_Y = DESKTOP.cards.home.y + DESKTOP.cards.home.h;
const D_GRID_TOP_Y = DESKTOP.cards.grid.y;
const D_GRID_BOT_Y = DESKTOP.cards.grid.y + DESKTOP.cards.grid.h;
const DESKTOP_PATHS: Paths = {
  pvHome:      `M ${DA.pvRight.x} ${DA.pvRight.y} Q ${(DA.pvRight.x + DA.homeLeft.x) / 2} ${DA.homeLeft.y}, ${DA.homeLeft.x} ${DA.homeLeft.y}`,
  pvBattery:   `M ${DA.pvRight.x} ${DA.pvRight.y} Q ${(DA.pvRight.x + DA.batteryLeft.x) / 2} ${DA.batteryLeft.y}, ${DA.batteryLeft.x} ${DA.batteryLeft.y}`,
  batteryHome: `M ${DA.batteryTop.x} ${DA.batteryTop.y} L ${DA.homeBottom.x} ${DA.homeBottom.y}`,
  homeGrid:    `M ${D_HOME_RIGHT_X} ${D_HOME_TOP_Y + 28} Q ${(D_HOME_RIGHT_X + D_GRID_LEFT_X) / 2} ${(D_HOME_TOP_Y + D_GRID_TOP_Y) / 2 + 8}, ${D_GRID_LEFT_X} ${D_GRID_TOP_Y + 28}`,
  gridHome:    `M ${D_GRID_LEFT_X} ${D_GRID_BOT_Y - 28} Q ${(D_HOME_RIGHT_X + D_GRID_LEFT_X) / 2} ${(D_GRID_BOT_Y + D_HOME_BOT_Y) / 2 - 8}, ${D_HOME_RIGHT_X} ${D_HOME_BOT_Y - 28}`,
};
const DESKTOP_LABELS: Labels = {
  pvHome:      { x: (DA.pvRight.x + DA.homeLeft.x) / 2,    y: (DA.pvRight.y + DA.homeLeft.y) / 2 - 16, anchor: "middle" },
  pvBattery:   { x: (DA.pvRight.x + DA.batteryLeft.x) / 2, y: (DA.pvRight.y + DA.batteryLeft.y) / 2 + 18, anchor: "middle" },
  batteryHome: { x: DA.batteryTop.x + 14,                  y: (DA.batteryTop.y + DA.homeBottom.y) / 2 - 6, anchor: "start" },
  homeGrid:    { x: (D_HOME_RIGHT_X + D_GRID_LEFT_X) / 2,  y: (D_HOME_TOP_Y + D_GRID_TOP_Y) / 2 + 14,  anchor: "middle" },
  gridHome:    { x: (D_HOME_RIGHT_X + D_GRID_LEFT_X) / 2,  y: (D_GRID_BOT_Y + D_HOME_BOT_Y) / 2 - 22,  anchor: "middle" },
};

const MOBILE: Total & { cards: Cards } = {
  W: 360, H: 540,
  cards: {
    pv:      { x: 100, y: 20,  w: 160, h: 104 },
    battery: { x: 12,  y: 218, w: 124, h: 104 },
    home:    { x: 224, y: 218, w: 124, h: 104 },
    grid:    { x: 100, y: 416, w: 160, h: 104 },
  },
};
const MA = anchors(MOBILE.cards);
const M_HOME_BOT_Y = MOBILE.cards.home.y + MOBILE.cards.home.h;
const M_GRID_TOP_Y = MOBILE.cards.grid.y;
const M_HOME_LEFT_Q = MOBILE.cards.home.x + MOBILE.cards.home.w * 0.25;
const M_HOME_RIGHT_Q = MOBILE.cards.home.x + MOBILE.cards.home.w * 0.75;
const M_GRID_LEFT_Q = MOBILE.cards.grid.x + MOBILE.cards.grid.w * 0.25;
const M_GRID_RIGHT_Q = MOBILE.cards.grid.x + MOBILE.cards.grid.w * 0.75;
const MOBILE_PATHS: Paths = {
  pvBattery:   `M ${MA.pvBottom.x} ${MA.pvBottom.y} Q ${MA.pvBottom.x - 50} ${(MA.pvBottom.y + MA.batteryTop.y) / 2}, ${MA.batteryTop.x} ${MA.batteryTop.y}`,
  pvHome:      `M ${MA.pvBottom.x} ${MA.pvBottom.y} Q ${MA.pvBottom.x + 50} ${(MA.pvBottom.y + MA.homeTop.y) / 2}, ${MA.homeTop.x} ${MA.homeTop.y}`,
  batteryHome: `M ${MA.batteryRight.x} ${MA.batteryRight.y} L ${MA.homeLeft.x} ${MA.homeLeft.y}`,
  homeGrid:    `M ${M_HOME_LEFT_Q} ${M_HOME_BOT_Y} Q ${(M_HOME_LEFT_Q + M_GRID_LEFT_Q) / 2 - 8} ${(M_HOME_BOT_Y + M_GRID_TOP_Y) / 2}, ${M_GRID_LEFT_Q} ${M_GRID_TOP_Y}`,
  gridHome:    `M ${M_GRID_RIGHT_Q} ${M_GRID_TOP_Y} Q ${(M_HOME_RIGHT_Q + M_GRID_RIGHT_Q) / 2 + 8} ${(M_HOME_BOT_Y + M_GRID_TOP_Y) / 2}, ${M_HOME_RIGHT_Q} ${M_HOME_BOT_Y}`,
};
const MOBILE_LABELS: Labels = {
  pvBattery:   { x: MA.batteryTop.x + 28, y: (MA.pvBottom.y + MA.batteryTop.y) / 2 - 16, anchor: "start" },
  pvHome:      { x: MA.homeTop.x - 28,    y: (MA.pvBottom.y + MA.homeTop.y) / 2 - 16,    anchor: "end" },
  batteryHome: { x: (MA.batteryRight.x + MA.homeLeft.x) / 2, y: MA.batteryRight.y - 14, anchor: "middle" },
  homeGrid:    { x: (M_HOME_LEFT_Q + M_GRID_LEFT_Q) / 2 - 4,   y: (M_HOME_BOT_Y + M_GRID_TOP_Y) / 2 - 12, anchor: "middle" },
  gridHome:    { x: (M_HOME_RIGHT_Q + M_GRID_RIGHT_Q) / 2 + 4, y: (M_HOME_BOT_Y + M_GRID_TOP_Y) / 2 - 12, anchor: "middle" },
};

function strokeWidth(intensity: number) {
  return Math.max(1.4, Math.min(5.5, 1 + intensity * 5));
}
function dotCount(intensity: number) {
  if (intensity < T_VISIBLE) return 0;
  if (intensity < 0.05)      return 1;
  if (intensity < 0.25)      return 2;
  return 3;
}

// ─── Public types ────────────────────────────────────────────────────────

export type Trend = {
  pct: number | null;
  vs: string;
};

export type ModuleSpec = {
  big: string;
  small?: string;
  trend?: Trend;
  highlighted: boolean;
  variant?: "import" | "export" | "idle";
  /** Render value in light grey (no-data / zero state). */
  dim?: boolean;
  /** Optional info popover next to the card label. */
  info?: { title?: string; formula?: string; description?: string };
};

export type FlowSpec = {
  intensity: number;
  label: string;
  trend?: Trend;
};

type Props = {
  modules: { pv: ModuleSpec; battery: ModuleSpec; home: ModuleSpec; grid: ModuleSpec };
  flows: { pvHome: FlowSpec; pvBattery: FlowSpec; batteryHome: FlowSpec; homeGrid: FlowSpec; gridHome: FlowSpec };
  tooltips: Record<FlowKey, string>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function fmtTrendPct(pct: number): string {
  const a = Math.abs(pct);
  const fmt = a >= 100 ? Math.round(a).toString()
    : a >= 10 ? a.toFixed(0)
    : a.toFixed(1).replace(".", ",");
  return `${fmt} %`;
}

function TrendInline({ trend, dim }: { trend: Trend; dim?: boolean }) {
  const baseClass = dim ? "text-ink-300" : "text-ink-500";
  if (trend.pct == null) {
    return (
      <span className={cn("inline-flex items-center gap-0.5 text-[11px]", baseClass)} title={`vs. ${trend.vs}`}>
        <Minus size={10} strokeWidth={2.4} />
      </span>
    );
  }
  const flat = Math.abs(trend.pct) < 0.5;
  const Icon = flat ? Minus : trend.pct > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px]", baseClass)} title={`vs. ${trend.vs}`}>
      <Icon size={10} strokeWidth={2.4} />
      <span className="font-mono tabular-nums">{flat ? "≈" : fmtTrendPct(trend.pct)}</span>
    </span>
  );
}

/** Render "12,5 kWh" as <span>12,5</span><span class=unit>kWh</span> */
function NumberWithUnit({ value }: { value: string }) {
  const idx = value.indexOf(" ");
  if (idx < 0) return <>{value}</>;
  const num = value.slice(0, idx);
  const unit = value.slice(idx + 1);
  return (
    <>
      <span>{num}</span>
      <span className="ml-1 text-[0.72em] font-medium opacity-70">{unit}</span>
    </>
  );
}

// ─── Components ──────────────────────────────────────────────────────────

function FlowArc({
  d, flow, color, reduceMotion, labelPos, duration = 2.5, onActivate, isActive, reverse,
}: {
  d: string;
  flow: FlowSpec;
  color: string;
  reduceMotion: boolean;
  labelPos: LabelPos;
  duration?: number;
  onActivate: () => void;
  isActive: boolean;
  reverse?: boolean;
}) {
  // Below threshold: render thin grey ghost line so the diagram structure
  // stays visible (user reads "system connected, just no flow right now").
  if (flow.intensity < T_VISIBLE) {
    return (
      <g>
        <path d={d} stroke={COLORS.inactive} strokeWidth={1.2} strokeLinecap="round" fill="none" opacity={0.6} />
      </g>
    );
  }

  const sw = strokeWidth(flow.intensity);
  const dots = !reduceMotion ? dotCount(flow.intensity) : 0;
  const showTrend = flow.trend != null;
  const labelHeight = showTrend ? 30 : 20;
  const labelY = labelPos.y - 11;
  const trendY = labelPos.y + 11;
  const labelWidth = 56;

  return (
    <g style={{ cursor: "pointer" }} onClick={onActivate} onMouseEnter={onActivate}>
      <path d={d} stroke={color} strokeWidth={sw} strokeLinecap="round" fill="none" />
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
      {flow.label ? (
        <g pointerEvents="none">
          <rect
            x={labelPos.anchor === "middle" ? labelPos.x - labelWidth / 2 : labelPos.anchor === "start" ? labelPos.x - 4 : labelPos.x - labelWidth + 4}
            y={labelY}
            width={labelWidth}
            height={labelHeight}
            rx={6}
            fill="white"
            opacity={0.96}
            stroke={isActive ? color : "#e4e4e7"}
            strokeWidth={isActive ? 1.5 : 0.5}
          />
          <text x={labelPos.x} y={showTrend ? labelPos.y - 1 : labelPos.y + 1}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="600"
            fill={color} textAnchor={labelPos.anchor} dominantBaseline="middle">
            {flow.label}
          </text>
          {showTrend && flow.trend ? (
            <text x={labelPos.x} y={trendY} fontFamily="ui-sans-serif, system-ui" fontSize="9" fontWeight="500"
              fill="#71717a" textAnchor={labelPos.anchor} dominantBaseline="middle">
              {flow.trend.pct == null ? "—" : Math.abs(flow.trend.pct) < 0.5 ? "≈" : `${flow.trend.pct > 0 ? "↑" : "↓"} ${fmtTrendPct(flow.trend.pct)}`}
            </text>
          ) : null}
        </g>
      ) : null}
    </g>
  );
}

function NodeCard({
  className, style, icon, label, spec, accentColor, compact = false,
}: {
  className?: string;
  style?: React.CSSProperties;
  icon: React.ReactNode;
  label: string;
  spec: ModuleSpec;
  accentColor: string;
  compact?: boolean;
}) {
  const valueColor = spec.highlighted ? accentColor : spec.dim ? "#a1a1aa" : "#3f3f46";
  return (
    <motion.div
      className={cn("rounded-2xl border bg-white border-ink-200/60 overflow-hidden", compact ? "p-2.5" : "p-3", "shadow-card")}
      style={style}
      animate={{
        boxShadow: spec.highlighted
          ? `0 4px 14px ${accentColor}33, 0 0 0 1px ${accentColor}40`
          : "0 1px 3px rgba(0,0,0,0.06)",
      }}
      transition={{ duration: 0.6 }}
    >
      <div className="flex items-center gap-1.5">
        <div
          className={cn("flex shrink-0 items-center justify-center rounded-lg", compact ? "h-6 w-6" : "h-7 w-7")}
          style={{
            background: spec.dim ? `${accentColor}10` : `${accentColor}15`,
            color: spec.dim ? "#a1a1aa" : accentColor,
          }}
        >
          {icon}
        </div>
        <span className={cn("font-medium uppercase tracking-wide", spec.dim ? "text-ink-400" : "text-ink-500", compact ? "text-[10px]" : "text-xs")}>
          {label}
        </span>
        {spec.info ? (
          <InfoTooltip
            title={spec.info.title}
            formula={spec.info.formula}
            description={spec.info.description}
          />
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1 font-mono font-semibold tabular-nums leading-tight whitespace-nowrap",
          compact ? "text-[15px]" : "text-lg",
        )}
        style={{ color: valueColor }}
      >
        <NumberWithUnit value={spec.big} />
      </div>
      {spec.small ? (
        <div className={cn("mt-0.5 text-[11px] leading-tight truncate", spec.dim ? "text-ink-300" : "text-ink-500")}>
          {spec.small}
        </div>
      ) : null}
      {spec.trend ? (
        <div className="mt-0.5">
          <TrendInline trend={spec.trend} dim={spec.dim} />
        </div>
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
      <FlowArc d={paths.pvHome}      flow={flows.pvHome}      color={COLORS.pv}         reduceMotion={reduceMotion} labelPos={labels.pvHome}      onActivate={() => setActiveFlow("pvHome")}      isActive={activeFlow === "pvHome"} />
      <FlowArc d={paths.pvBattery}   flow={flows.pvBattery}   color={COLORS.pv}         reduceMotion={reduceMotion} labelPos={labels.pvBattery}   onActivate={() => setActiveFlow("pvBattery")}   isActive={activeFlow === "pvBattery"} duration={3} />
      <FlowArc d={paths.batteryHome} flow={flows.batteryHome} color={COLORS.battery}    reduceMotion={reduceMotion} labelPos={labels.batteryHome} onActivate={() => setActiveFlow("batteryHome")} isActive={activeFlow === "batteryHome"} />
      <FlowArc d={paths.homeGrid}    flow={flows.homeGrid}    color={COLORS.gridExport} reduceMotion={reduceMotion} labelPos={labels.homeGrid}    onActivate={() => setActiveFlow("homeGrid")}    isActive={activeFlow === "homeGrid"} />
      <FlowArc d={paths.gridHome}    flow={flows.gridHome}    color={COLORS.gridImport} reduceMotion={reduceMotion} labelPos={labels.gridHome}    onActivate={() => setActiveFlow("gridHome")}    isActive={activeFlow === "gridHome"} />
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
}: { x: number; y: number; total: Total; text: string; onDismiss: () => void }) {
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
