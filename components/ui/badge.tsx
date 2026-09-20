import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        /* Neutral */
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        outline:
          "border-border text-foreground",
        muted:
          "border-transparent bg-muted text-muted-foreground",

        /* Semantic status variants */
        success:
          "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400",
        warning:
          "border-transparent bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400",
        destructive:
          "border-transparent bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400",
        info:
          "border-transparent bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400",

        /* ERP workflow states */
        draft:
          "border-transparent bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
        pending:
          "border-transparent bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400",
        approved:
          "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400",
        rejected:
          "border-transparent bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400",
        completed:
          "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400",
        cancelled:
          "border-transparent bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
        processing:
          "border-transparent bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400",
        overdue:
          "border-transparent bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    dot?: boolean;
  };

const dotColor: Record<string, string> = {
  success: "bg-emerald-500",
  approved: "bg-emerald-500",
  completed: "bg-emerald-500",
  warning: "bg-amber-500",
  pending: "bg-amber-500",
  destructive: "bg-red-500",
  rejected: "bg-red-500",
  overdue: "bg-red-500",
  info: "bg-blue-500",
  processing: "bg-blue-500",
  draft: "bg-zinc-400",
  cancelled: "bg-zinc-400",
  default: "bg-primary",
  secondary: "bg-secondary-foreground",
  outline: "bg-foreground",
  muted: "bg-muted-foreground",
};

function Badge({ className, variant = "default", dot, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            dotColor[variant ?? "default"] ?? "bg-foreground"
          )}
        />
      )}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
export type { BadgeProps };
