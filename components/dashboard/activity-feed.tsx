import * as React from "react";
import { cn } from "@/lib/utils";

type ActivityItem = {
  id: string;
  title: string;
  description?: string;
  time: string;
  icon?: React.ElementType;
  iconClassName?: string;
};

type ActivityFeedProps = {
  items: ActivityItem[];
  className?: string;
};

export function ActivityFeed({ items, className }: ActivityFeedProps) {
  return (
    <div className={cn("space-y-0", className)}>
      {items.map((item, i) => (
        <div key={item.id} className="relative flex gap-3 pb-4">
          {/* Connector line */}
          {i < items.length - 1 && (
            <span className="absolute left-3.5 top-7 -bottom-0 w-px bg-border" />
          )}

          {/* Icon */}
          <div
            className={cn(
              "relative flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground",
              item.iconClassName
            )}
          >
            {item.icon ? (
              <item.icon className="size-3.5" />
            ) : (
              <span className="size-1.5 rounded-full bg-muted-foreground" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 pt-0.5">
            <p className="text-sm font-medium text-foreground leading-snug">
              {item.title}
            </p>
            {item.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.description}
              </p>
            )}
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">
              {item.time}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
