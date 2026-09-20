import * as React from "react";
import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<"input"> & {
  /** Icon or element shown on the left */
  startAdornment?: React.ReactNode;
  /** Icon or element shown on the right */
  endAdornment?: React.ReactNode;
};

function Input({
  className,
  type,
  startAdornment,
  endAdornment,
  ...props
}: InputProps) {
  if (!startAdornment && !endAdornment) {
    return (
      <input
        type={type}
        data-slot="input"
        className={cn(
          "flex h-8 w-full rounded-md border bg-background px-3 py-1 text-sm",
          "text-foreground placeholder:text-muted-foreground",
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:border-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
          "dark:bg-input/30",
          className
        )}
        {...props}
      />
    );
  }

  return (
    <div className="relative flex items-center">
      {startAdornment && (
        <span className="pointer-events-none absolute left-2.5 flex items-center text-muted-foreground [&_svg]:size-3.5">
          {startAdornment}
        </span>
      )}
      <input
        type={type}
        data-slot="input"
        className={cn(
          "flex h-8 w-full rounded-md border bg-background text-sm",
          "text-foreground placeholder:text-muted-foreground",
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:border-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
          "dark:bg-input/30",
          startAdornment ? "pl-8" : "pl-3",
          endAdornment ? "pr-8" : "pr-3",
          "py-1",
          className
        )}
        {...props}
      />
      {endAdornment && (
        <span className="pointer-events-none absolute right-2.5 flex items-center text-muted-foreground [&_svg]:size-3.5">
          {endAdornment}
        </span>
      )}
    </div>
  );
}

export { Input };
