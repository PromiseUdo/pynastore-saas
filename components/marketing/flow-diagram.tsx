'use client';

/*
 * "Every sale lands in one place": the three ways a shop sells feeding one
 * stock count, and what happens next — the parcel leaves from the store
 * that has it, and the money lands in the merchant's bank. On a phone the
 * same story reads top to bottom.
 *
 * It plays the story out. Every few seconds a sale arrives from one of the
 * three channels (counter → Ikeja, website → Lekki, Instagram → Abuja): that
 * channel lights up, its branch's count drops by one with a "−1", and the
 * total follows. When Lekki falls to 3 it turns saffron — the low-stock
 * warning, shown rather than described. After a few sales the counts quietly
 * reset and it starts again.
 *
 * It only runs while on screen, and not at all for visitors who ask for
 * reduced motion: they get the still picture, which says the same thing.
 * The figcaption carries the meaning for screen readers either way.
 */
import * as React from 'react';
import { ArrowDown, Globe, Landmark, Share2, Store, Truck } from 'lucide-react';
import { PLATFORM_DOMAIN } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { Swatch } from './product-visuals';

const START = [11, 5, 7];
const LOW = 3;
/** Which branch each channel's sale comes off, in turn. */
const CHANNEL_STORE = [0, 1, 2];
const SALES_PER_ROUND = 6;
const STEP_MS = 2600;

function Node({
  icon: Icon,
  title,
  detail,
  active = false,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex items-center gap-3 rounded-2xl border bg-card p-3.5 shadow-[0_10px_30px_-20px_rgba(17,33,26,0.35)] transition-[border-color,box-shadow,transform] duration-500',
        active && 'border-primary shadow-[0_16px_36px_-18px_rgba(14,107,71,0.55)] lg:-translate-y-0.5',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl bg-mk-leaf text-primary transition-colors duration-500',
          active && 'bg-primary text-primary-foreground',
        )}
      >
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-tight">{title}</span>
        <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{detail}</span>
      </span>
      {active && (
        <span className="absolute -top-2.5 right-3 rounded-full bg-mk-sun px-2 py-0.5 text-[11px] font-semibold text-[#11211a] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95">
          New sale
        </span>
      )}
    </div>
  );
}

/** Connector lines between the columns (wide screens only). */
function Wires({ from, to }: { from: number[]; to: number[] }) {
  const paths = from.flatMap((y1) => to.map((y2) => `M0,${y1} C30,${y1} 30,${y2} 60,${y2}`));
  return (
    <svg aria-hidden viewBox="0 0 60 300" preserveAspectRatio="none" className="hidden h-full w-14 lg:block">
      {paths.map((d) => (
        <path key={d} d={d} fill="none" stroke="var(--border)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      ))}
      {paths.map((d) => (
        <path
          key={`${d}-flow`}
          d={d}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeDasharray="3 7"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="mk-flow"
        />
      ))}
    </svg>
  );
}

function Down() {
  return (
    <div aria-hidden className="flex justify-center py-1 text-primary lg:hidden">
      <ArrowDown className="size-5" />
    </div>
  );
}

/** Plays sales in while the figure is on screen; null = still picture. */
function useSales(ref: React.RefObject<HTMLElement | null>) {
  const [state, setState] = React.useState({ counts: START, channel: null as number | null, sale: 0 });

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () =>
      setState((s) => {
        const round = s.sale % SALES_PER_ROUND === 0 && s.sale > 0;
        const counts = round ? START : s.counts;
        const channel = s.sale % 3;
        const store = CHANNEL_STORE[channel];
        return {
          counts: counts.map((n, i) => (i === store ? Math.max(n - 1, 1) : n)),
          channel,
          sale: s.sale + 1,
        };
      });

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !timer) {
        tick();
        timer = setInterval(tick, STEP_MS);
      } else if (!entry.isIntersecting && timer) {
        clearInterval(timer);
        timer = null;
      }
    }, { threshold: 0.4 });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearInterval(timer);
    };
  }, [ref]);

  return state;
}

export function FlowDiagram() {
  const ref = React.useRef<HTMLElement>(null);
  const { counts, channel, sale } = useSales(ref);
  const stores = ['Ikeja', 'Lekki', 'Abuja'];
  const soldFrom = channel === null ? null : CHANNEL_STORE[channel];
  const total = counts.reduce((a, b) => a + b, 0);

  return (
    <figure ref={ref}>
      <div aria-hidden className="grid items-stretch lg:grid-cols-[1fr_auto_1.15fr_auto_1fr]">
        {/* where it sells */}
        <div className="grid gap-3 lg:grid-rows-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:hidden">You sell</p>
          <Node icon={Store} title="At your counter" detail="Walk-in sale at Ikeja · ₦12,500" active={channel === 0} />
          <Node icon={Globe} title="On your website" detail={`Order from shop-adaeze.${PLATFORM_DOMAIN}`} active={channel === 1} />
          <Node icon={Share2} title="On Instagram and Facebook" detail="A shopper orders from your post" active={channel === 2} />
        </div>
        <Wires from={[50, 150, 250]} to={[150]} />
        <Down />

        {/* one stock count */}
        <div className="flex items-center">
          <div className="w-full rounded-3xl border-2 border-primary bg-card p-5 shadow-[0_24px_50px_-24px_rgba(14,107,71,0.45)]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-primary">One stock count</p>
            <div className="mt-3 flex items-center gap-3">
              <Swatch fabric="ankara" className="size-12 rounded-xl" />
              <div>
                <p className="text-[15px] font-semibold leading-tight">Ankara wrap dress</p>
                <p className="text-[13px] text-muted-foreground">
                  Size M · <span className="tabular-nums">{total}</span> in stock
                </p>
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-3 gap-2 text-center">
              {stores.map((name, i) => {
                const low = counts[i] <= LOW;
                const hit = soldFrom === i;
                return (
                  <li
                    key={name}
                    className={cn(
                      'relative rounded-xl border px-2 py-2 transition-colors duration-500',
                      low ? 'border-mk-sun bg-mk-sun-soft' : 'bg-muted/50',
                      hit && !low && 'border-primary',
                    )}
                  >
                    <span className="block text-[12px] text-muted-foreground">{name}</span>
                    <span className="font-mk-display text-xl font-bold tabular-nums">{counts[i]}</span>
                    {hit && (
                      <span
                        key={sale}
                        className="pointer-events-none absolute -top-2.5 right-1.5 rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground motion-safe:animate-out motion-safe:fade-out motion-safe:slide-out-to-top-3 motion-safe:delay-700 motion-safe:duration-1000 motion-safe:fill-mode-forwards"
                      >
                        −1
                      </span>
                    )}
                    {/* Always there, so the box doesn't jump when it appears. */}
                    <span className={cn('block text-[10.5px] font-semibold text-[#8a5a00]', !low && 'invisible')}>Running low</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
              Every sale comes off the branch it was sold from, so the number online is the number on the shelf.
            </p>
          </div>
        </div>
        <Wires from={[150]} to={[75, 225]} />
        <Down />

        {/* what happens next */}
        <div className="grid gap-3 lg:grid-rows-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:hidden">Then</p>
          <Node icon={Truck} title="Sent from the right branch" detail="The one that has it, at your delivery prices" className="lg:self-center" />
          <Node icon={Landmark} title="Paid into your bank" detail="By Paystack, straight to your account" className="lg:self-center" />
        </div>
      </div>
      <figcaption className="sr-only">
        A diagram: sales at the counter, on the shop’s website and through Instagram and Facebook all come off one stock count kept for each branch. Orders are sent from the
        branch that has the item, and online payments are paid into the merchant’s own bank account.
      </figcaption>
    </figure>
  );
}
