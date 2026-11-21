'use client';

/*
 * One row of features drifting past under the hero: running the shop, then
 * what shoppers get. A glance says "it does all of this" before anyone
 * reads a section.
 *
 * Every pill is something the product does today (AGENTS: no claims we
 * can't back). Plan-gated ones are still features; the pricing page says
 * which plan has them.
 *
 * Motion: the row holds its list twice and slides by half its width, so it
 * loops without a seam. It's moved frame by frame here rather than by a CSS
 * animation: pausing a CSS animation stops it dead (Safari also jumps it),
 * whereas here the speed eases down to a stop under the pointer and back up
 * when it leaves. It doesn't run off screen, and for anyone who asks for
 * less motion it stands still and scrolls sideways by hand instead
 * (globals.css, `.mk-marquee-track`). The moving copies are hidden from
 * screen readers, which get one plain list.
 */
import * as React from 'react';
import {
  ArrowLeftRight,
  BellRing,
  Boxes,
  Building2,
  CalendarClock,
  ChartColumn,
  ClipboardCheck,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Gift,
  Globe,
  Heart,
  Landmark,
  MapPin,
  Megaphone,
  MessageCircle,
  PackageCheck,
  PackageSearch,
  Palette,
  Receipt,
  ScanSearch,
  Shirt,
  Smartphone,
  Sparkles,
  Star,
  Store,
  TicketPercent,
  Truck,
  Undo2,
  UserRound,
  UsersRound,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Feature = { icon: LucideIcon; label: string };

/** Running the shop. */
const FOR_YOU: Feature[] = [
  { icon: Warehouse, label: 'Several branches, one stock' },
  { icon: Boxes, label: 'Stock counted per branch' },
  { icon: BellRing, label: 'Low-stock alerts' },
  { icon: ArrowLeftRight, label: 'Move stock between branches' },
  { icon: ClipboardCheck, label: 'Shelf counts' },
  { icon: Shirt, label: 'Sizes and colours' },
  { icon: FileSpreadsheet, label: 'Import from a spreadsheet' },
  { icon: Gift, label: 'Bundles and gift sets' },
  { icon: Truck, label: 'Suppliers and purchase orders' },
  { icon: Store, label: 'Counter sales' },
  { icon: FileText, label: 'Quotes and invoices' },
  { icon: TicketPercent, label: 'Discount codes' },
  { icon: CalendarClock, label: 'Scheduled sales' },
  { icon: Building2, label: 'Wholesale prices' },
  { icon: Megaphone, label: 'Post to Instagram and Facebook' },
  { icon: UsersRound, label: 'Staff roles and permissions' },
  { icon: ChartColumn, label: 'Sales and profit reports' },
  { icon: Smartphone, label: 'Order alerts on your phone' },
];

/** What shoppers get. */
const FOR_SHOPPERS: Feature[] = [
  { icon: Globe, label: 'Your own website and address' },
  { icon: Palette, label: 'Your colours and layout' },
  { icon: Sparkles, label: 'AI shopping assistant' },
  { icon: ScanSearch, label: 'Search with a photo' },
  { icon: MapPin, label: 'Delivery prices by area' },
  { icon: PackageCheck, label: 'Pickup points' },
  { icon: CreditCard, label: 'Card payments by Paystack' },
  { icon: Landmark, label: 'Bank transfer' },
  { icon: Receipt, label: 'Pay on delivery' },
  { icon: MessageCircle, label: 'Chat with the shop' },
  { icon: UserRound, label: 'Shopper accounts' },
  { icon: Heart, label: 'Wishlists' },
  { icon: PackageSearch, label: 'Order tracking' },
  { icon: Undo2, label: 'Returns and refunds' },
  { icon: Star, label: 'Reviews from real buyers' },
  { icon: Smartphone, label: 'Your shop’s own app' },
];

function Pill({ icon: Icon, label }: Feature) {
  return (
    <li className="flex shrink-0 items-center gap-2 rounded-xl border bg-background px-3 py-2 shadow-[0_8px_24px_-18px_rgba(17,33,26,0.35)]">
      <span className="flex size-6 items-center justify-center rounded-full bg-mk-leaf text-primary">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="whitespace-nowrap text-[13px] font-semibold text-foreground">{label}</span>
    </li>
  );
}

/** Pixels a second at full speed. */
const SPEED = 36;
/** How quickly the speed follows the pointer: higher is snappier. */
const EASE = 4;

function Row({ features, reverse = false }: { features: Feature[]; reverse?: boolean }) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const hovering = React.useRef(false);

  React.useEffect(() => {
    const track = trackRef.current;
    const list = listRef.current;
    if (!track || !list) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let last = 0;
    let speed = SPEED;
    let offset = 0;
    let visible = true;

    const step = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      const target = hovering.current ? 0 : SPEED;
      speed += (target - speed) * Math.min(1, dt * EASE);
      const half = list.scrollWidth / 2;
      if (half > 0) {
        offset = (offset + speed * dt) % half;
        const x = reverse ? offset - half : -offset;
        list.style.transform = `translate3d(${x}px, 0, 0)`;
      }
      frame = visible ? requestAnimationFrame(step) : 0;
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !frame) {
        last = 0;
        frame = requestAnimationFrame(step);
      }
    });
    observer.observe(track);
    frame = requestAnimationFrame(step);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [reverse]);

  return (
    <div
      ref={trackRef}
      onPointerEnter={() => (hovering.current = true)}
      onPointerLeave={() => (hovering.current = false)}
      className="mk-marquee-track overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]"
    >
      <ul ref={listRef} aria-hidden className="flex w-max gap-2.5 py-1 will-change-transform">
        {[...features, ...features].map((f, i) => (
          <Pill key={`${f.label}-${i}`} {...f} />
        ))}
      </ul>
    </div>
  );
}

export function FeatureMarquee({ className }: { className?: string }) {
  return (
    <section aria-labelledby="feature-marquee-title" className={cn('relative', className)}>
      <h2 id="feature-marquee-title" className="sr-only">
        What you get
      </h2>
      <Row features={[...FOR_YOU, ...FOR_SHOPPERS]} reverse />
      <div className="sr-only">
        <p>For running your shop:</p>
        <ul>
          {FOR_YOU.map((f) => (
            <li key={f.label}>{f.label}</li>
          ))}
        </ul>
        <p>For your shoppers:</p>
        <ul>
          {FOR_SHOPPERS.map((f) => (
            <li key={f.label}>{f.label}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
