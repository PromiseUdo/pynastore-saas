'use client';

/*
 * The period every report in the hub covers. Lives in the URL (`range`, or
 * `from` + `to` for chosen dates) so a report survives a refresh and can be
 * sent to someone exactly as it was seen (AGENTS §3).
 */
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DEFAULT_PRESET, PRESET_LABEL, REPORT_PRESETS, type ReportPreset } from '@/lib/reports/period';

const CUSTOM = 'custom';

export function PeriodPicker({
  current,
  firstDay,
  lastDay,
  today,
}: {
  current: ReportPreset | 'custom';
  firstDay: string;
  lastDay: string;
  /** YYYY-MM-DD in Lagos, the latest day that can be chosen */
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [choosing, setChoosing] = React.useState(current === CUSTOM);
  const [from, setFrom] = React.useState(firstDay);
  const [to, setTo] = React.useState(lastDay);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFrom(firstDay);
    setTo(lastDay);
  }, [firstDay, lastDay]);

  function go(update: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('range');
    next.delete('from');
    next.delete('to');
    update(next);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function choosePreset(value: string) {
    if (value === CUSTOM) {
      setChoosing(true);
      return;
    }
    setChoosing(false);
    go((next) => {
      if (value !== DEFAULT_PRESET) next.set('range', value);
    });
  }

  function applyDates(event: React.FormEvent) {
    event.preventDefault();
    if (!from || !to) {
      setError('Choose both dates.');
      return;
    }
    setError(null);
    go((next) => {
      next.set('from', from);
      next.set('to', to);
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-44">
        <SelectRoot value={choosing ? CUSTOM : current} onValueChange={choosePreset}>
          <SelectTrigger aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORT_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {PRESET_LABEL[preset]}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM}>Choose dates</SelectItem>
          </SelectContent>
        </SelectRoot>
      </div>

      {choosing && (
        <form onSubmit={applyDates} className="flex flex-wrap items-end gap-2" noValidate>
          <div className="space-y-1">
            <Label htmlFor="report-from" className="text-xs">
              From
            </Label>
            <Input
              id="report-from"
              type="date"
              value={from}
              max={today}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="report-to" className="text-xs">
              To
            </Label>
            <Input
              id="report-to"
              type="date"
              value={to}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          <Button type="submit" variant="outline" size="sm" className="h-9">
            Show these dates
          </Button>
          {error && (
            <p className="w-full text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
