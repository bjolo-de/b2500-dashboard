import { Card, CardBody, CardLabel } from "./ui/card";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  hint?: string;
  accent?: "pv" | "grid" | "battery" | "neutral";
  className?: string;
};

const ACCENT: Record<NonNullable<Props["accent"]>, string> = {
  pv: "text-pv",
  grid: "text-grid",
  battery: "text-battery",
  neutral: "text-ink-900",
};

export function KpiCard({
  label,
  value,
  hint,
  accent = "neutral",
  className,
}: Props) {
  return (
    <Card className={cn("animate-fade-in", className)}>
      <CardBody>
        <CardLabel>{label}</CardLabel>
        <div
          className={cn(
            "mt-1 font-mono text-2xl font-semibold tabular-nums",
            ACCENT[accent],
          )}
        >
          {value}
        </div>
        {hint ? <div className="mt-1 text-xs text-ink-500">{hint}</div> : null}
      </CardBody>
    </Card>
  );
}
