import * as React from "react";
import { cn } from "@/lib/utils";

/* ─── Field ─────────────────────────────────────────────────────────────── */

type FieldProps = React.ComponentProps<"div"> & {
  /** Stack horizontally (label left, control right) on md+ screens */
  horizontal?: boolean;
};

function Field({ className, horizontal, ...props }: FieldProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        horizontal && "md:flex-row md:items-start md:gap-6",
        className
      )}
      {...props}
    />
  );
}

/* ─── Field label group (label + description) ───────────────────────────── */

function FieldLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    />
  );
}

/* ─── Field description ─────────────────────────────────────────────────── */

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

/* ─── Field error ───────────────────────────────────────────────────────── */

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      role="alert"
      className={cn("text-xs font-medium text-destructive", className)}
      {...props}
    />
  );
}

/* ─── Form section ───────────────────────────────────────────────────────── */

type FormSectionProps = React.ComponentProps<"div"> & {
  title?: string;
  description?: string;
};

function FormSection({
  className,
  title,
  description,
  children,
  ...props
}: FormSectionProps) {
  return (
    <div className={cn("space-y-4", className)} {...props}>
      {(title || description) && (
        <div className="border-b pb-3">
          {title && (
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          )}
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/* ─── Form grid ─────────────────────────────────────────────────────────── */

type FormGridProps = React.ComponentProps<"div"> & {
  cols?: 1 | 2 | 3;
};

function FormGrid({ className, cols = 2, children, ...props }: FormGridProps) {
  return (
    <div
      className={cn(
        "grid gap-4",
        cols === 1 && "grid-cols-1",
        cols === 2 && "grid-cols-1 sm:grid-cols-2",
        cols === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { Field, FieldLabel, FieldDescription, FieldError, FormSection, FormGrid };
