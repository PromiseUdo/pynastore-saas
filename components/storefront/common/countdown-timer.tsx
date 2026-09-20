'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

function parts(msLeft: number) {
  const clamped = Math.max(0, msLeft);
  return {
    days: Math.floor(clamped / 86_400_000),
    hours: Math.floor((clamped / 3_600_000) % 24),
    minutes: Math.floor((clamped / 60_000) % 60),
    seconds: Math.floor((clamped / 1000) % 60),
  };
}

/**
 * Ticking countdown to `endsAt`.
 *
 * `now` starts null and is only filled in by the effect, so the server and the
 * first client render both emit the "––" placeholder and there is nothing to
 * reconcile. Everything after that is driven by the interval.
 */
export function CountdownTimer({
  endsAt,
  className,
  showDays = false,
  tone = 'default',
}: {
  endsAt: string;
  className?: string;
  showDays?: boolean;
  /** `contrast` inverts the pills for use on the yellow deal band. */
  tone?: 'default' | 'contrast';
}) {
  const target = React.useMemo(() => new Date(endsAt).getTime(), [endsAt]);
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const p = parts(now === null ? 0 : target - now);
  const items = [
    ...(showDays || p.days > 0 ? [{ label: 'Days', value: p.days }] : []),
    { label: 'Hrs', value: p.hours },
    { label: 'Min', value: p.minutes },
    { label: 'Sec', value: p.seconds },
  ];

  return (
    <div className={cn('flex items-center gap-2.5', className)} suppressHydrationWarning>
      {items.map((item) => (
        <div key={item.label} className="flex flex-col items-center">
          <span
            className={cn(
              'flex h-14 min-w-14 items-center justify-center rounded-2xl px-2 text-xl font-bold tabular-nums',
              tone === 'contrast'
                ? 'bg-highlight-foreground text-highlight'
                : 'bg-foreground text-background',
            )}
          >
            {now === null ? '––' : String(item.value).padStart(2, '0')}
          </span>
          <span
            className={cn(
              'mt-2 text-[10px] font-semibold uppercase tracking-[0.12em]',
              tone === 'contrast' ? 'text-highlight-foreground/70' : 'text-muted-foreground',
            )}
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
