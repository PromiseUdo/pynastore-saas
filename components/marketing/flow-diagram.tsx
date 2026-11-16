/*
 * "Everything comes off one shelf": the three ways a shop sells feeding one
 * stock count, and what happens next — the parcel leaves from the store
 * that has it, and the money lands in the merchant's bank. On a phone the
 * same story reads top to bottom.
 */
import { ArrowDown, Globe, Landmark, Share2, Store, Truck } from 'lucide-react';
import { PLATFORM_DOMAIN } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { Swatch } from './product-visuals';

function Node({
  icon: Icon,
  title,
  detail,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border bg-card p-3.5 shadow-[0_10px_30px_-20px_rgba(17,33,26,0.35)]', className)}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-mk-leaf text-primary">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-tight">{title}</span>
        <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{detail}</span>
      </span>
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

export function FlowDiagram() {
  const stores = [
    { name: 'Ikeja', n: 11 },
    { name: 'Lekki', n: 3 },
    { name: 'Abuja', n: 7 },
  ];
  return (
    <figure>
      <div className="grid items-stretch lg:grid-cols-[1fr_auto_1.15fr_auto_1fr]">
        {/* where it sells */}
        <div className="grid gap-3 lg:grid-rows-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:hidden">You sell</p>
          <Node icon={Store} title="At your counter" detail="Walk-in sale at Ikeja · ₦12,500" />
          <Node icon={Globe} title="On your website" detail={`shop-adaeze.${PLATFORM_DOMAIN}`} />
          <Node icon={Share2} title="On Instagram and Facebook" detail="Post products from your catalogue" />
        </div>
        <Wires from={[50, 150, 250]} to={[150]} />
        <Down />

        {/* one stock */}
        <div className="flex items-center">
          <div className="w-full rounded-3xl border-2 border-primary bg-card p-5 shadow-[0_24px_50px_-24px_rgba(14,107,71,0.45)]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-primary">One stock count</p>
            <div className="mt-3 flex items-center gap-3">
              <Swatch fabric="ankara" className="size-12 rounded-xl" />
              <div>
                <p className="text-[15px] font-semibold leading-tight">Ankara wrap dress</p>
                <p className="text-[13px] text-muted-foreground">Size M · 21 in stock</p>
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-3 gap-2 text-center">
              {stores.map((s) => (
                <li key={s.name} className={cn('rounded-xl border px-2 py-2', s.n <= 3 ? 'border-mk-sun bg-mk-sun-soft' : 'bg-muted/50')}>
                  <span className="block text-[12px] text-muted-foreground">{s.name}</span>
                  <span className="font-mk-display text-xl font-bold tabular-nums">{s.n}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
              Every sale comes off the store it was sold from, so the number online is the number on the shelf.
            </p>
          </div>
        </div>
        <Wires from={[150]} to={[75, 225]} />
        <Down />

        {/* what happens next */}
        <div className="grid gap-3 lg:grid-rows-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:hidden">Then</p>
          <Node icon={Truck} title="Sent from the right store" detail="The one that has it, at your delivery prices" className="lg:self-center" />
          <Node icon={Landmark} title="Paid into your bank" detail="By Paystack, straight to your account" className="lg:self-center" />
        </div>
      </div>
      <figcaption className="sr-only">
        A diagram: sales at the counter, on the shop’s website and through Instagram and Facebook all come off one stock count kept per store. Orders are sent from the store that
        has the item, and online payments are paid into the merchant’s own bank account.
      </figcaption>
    </figure>
  );
}
