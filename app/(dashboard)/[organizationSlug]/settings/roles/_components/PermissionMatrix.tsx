'use client';

import * as React from 'react';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  getPermissionLabel,
  getModuleLabel,
  getPermissionsByModule,
  getModules,
} from '@/lib/permission-labels';
import type { PermissionKey } from '@/lib/permissions';

type PermissionMatrixProps = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  callerPermissions: string[];
  disabled?: boolean;
};

export function PermissionMatrix({
  selected,
  onChange,
  callerPermissions,
  disabled = false,
}: PermissionMatrixProps) {
  const byModule = getPermissionsByModule();
  const modules = getModules();
  const callerSet = new Set(callerPermissions);

  const selectedCount = selected.size;
  const selectedModules = [
    ...new Set(
      [...selected].map((k) => k.split('.')[0]),
    ),
  ];

  function toggle(key: PermissionKey) {
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  }

  function selectAll(mod: string) {
    const keys = (byModule[mod] ?? []).filter((k) => callerSet.has(k));
    const next = new Set(selected);
    for (const k of keys) next.add(k);
    onChange(next);
  }

  function clearModule(mod: string) {
    const keys = new Set(byModule[mod] ?? []);
    const next = new Set([...selected].filter((k) => !keys.has(k as PermissionKey)));
    onChange(next);
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-6">
        {modules.map((mod) => {
          const keys = byModule[mod] ?? [];
          const modSelected = keys.filter((k) => selected.has(k));
          const callerHasAny = keys.some((k) => callerSet.has(k));

          return (
            <div key={mod}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  {getModuleLabel(mod)}
                </h3>
                {callerHasAny && !disabled && (
                  <div className="flex gap-3 text-xs">
                    <button
                      type="button"
                      className="text-primary hover:underline disabled:opacity-50"
                      onClick={() => selectAll(mod)}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground hover:underline"
                      onClick={() => clearModule(mod)}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {keys.map((key) => {
                  const callerHolds = callerSet.has(key);
                  const isChecked = selected.has(key);
                  const isDisabled = disabled || !callerHolds;
                  const id = `perm-${key}`;

                  return (
                    <TooltipRoot key={key}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            'flex items-center gap-2 rounded-md border px-3 py-2 transition-colors',
                            isChecked && !isDisabled && 'border-primary/40 bg-primary/5',
                            isDisabled && 'opacity-50',
                            !isDisabled && 'hover:bg-muted/50 cursor-pointer',
                          )}
                          onClick={() => !isDisabled && toggle(key)}
                        >
                          <CheckboxRoot
                            id={id}
                            checked={isChecked}
                            disabled={isDisabled}
                            onCheckedChange={() => !isDisabled && toggle(key)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Label
                            htmlFor={id}
                            className={cn(
                              'flex-1 cursor-pointer select-none text-xs font-normal',
                              isDisabled && 'cursor-not-allowed',
                            )}
                          >
                            {getPermissionLabel(key)}
                          </Label>
                          {!callerHolds && (
                            <Lock className="size-3 shrink-0 text-muted-foreground" />
                          )}
                        </div>
                      </TooltipTrigger>
                      {!callerHolds && (
                        <TooltipContent side="top">
                          You don&apos;t have this permission
                        </TooltipContent>
                      )}
                    </TooltipRoot>
                  );
                })}
              </div>

              <div className="mt-2 h-px bg-border" />
            </div>
          );
        })}

        {/* Summary footer */}
        <p className="text-xs text-muted-foreground">
          {selectedCount === 0
            ? 'No permissions selected'
            : `${selectedCount} permission${selectedCount !== 1 ? 's' : ''} selected across ${selectedModules.length} module${selectedModules.length !== 1 ? 's' : ''}`}
        </p>
      </div>
    </TooltipProvider>
  );
}
