import * as React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Trend = {
  value: number;   /* percentage, positive = up */
  label?: string;  /* e.g. "vs last month" */
};

type StatCardProps = {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ElementType;
  trend?: Trend;
  loading?: boolean;
  className?: string;
};

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  loading,
  className,
}: StatCardProps) {
  const trendUp = trend && trend.value > 0;
  const trendDown = trend && trend.value < 0;
  const trendNeutral = trend && trend.value === 0;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-5 shadow-xs",
        className
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {Icon && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
        )}
      </div>

      {/* Value */}
      {loading ? (
        <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
      ) : (
        <p className="text-2xl font-semibold tracking-tight text-foreground">
          {value}
        </p>
      )}

      {/* Trend + description */}
      <div className="flex items-center gap-2">
        {trend && !loading && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded text-xs font-medium",
              trendUp && "text-emerald-600 dark:text-emerald-400",
              trendDown && "text-red-600 dark:text-red-400",
              trendNeutral && "text-muted-foreground"
            )}
          >
            {trendUp && <TrendingUp className="size-3" />}
            {trendDown && <TrendingDown className="size-3" />}
            {trendNeutral && <Minus className="size-3" />}
            {trendUp ? "+" : ""}
            {trend.value}%
          </span>
        )}
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

/* ─── Stat grid ─────────────────────────────────────────────────────────── */

export function StatGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4",
        className
      )}
    >
      {children}
    </div>
  );
}
