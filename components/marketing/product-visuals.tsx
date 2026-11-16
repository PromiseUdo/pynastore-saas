/*
 * Product visuals for the public site (ROADMAP 12.3, redrawn in 23). Drawn
 * in HTML rather than screenshots, so they stay sharp at every size and
 * true to the product's layout as it changes. Everything in them is an
 * illustration: "Adaeze Fabrics" is a sample shop, not a customer, and its
 * figures are made up — each <figure> says so to screen readers.
 *
 * Decorative pieces are aria-hidden; each figure carries a plain caption.
 */
import { Bell, Check, CreditCard, Landmark, MapPin, MessageCircle, Receipt, Store, Truck } from 'lucide-react';
import { PLATFORM_DOMAIN, PLATFORM_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';

/* ── building blocks ───────────────────────────────────────────────────── */

type Tone = 'green' | 'amber' | 'blue' | 'slate' | 'red';

export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
        tone === 'green' && 'bg-[#e1f2e7] text-[#0b5a3b]',
        tone === 'amber' && 'bg-[#fbecd0] text-[#8a5300]',
        tone === 'blue' && 'bg-[#e3ecfa] text-[#244a8f]',
        tone === 'red' && 'bg-[#f9e2dc] text-[#9b351c]',
        tone === 'slate' && 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Product photos for the sample shop: fabric patterns, drawn in CSS. */
const FABRICS = {
  ankara: {
    backgroundColor: '#1f3a5f',
    backgroundImage:
      'radial-gradient(circle at 20% 30%, #e8a33d 0 9%, transparent 10%), radial-gradient(circle at 70% 65%, #c2410c 0 12%, transparent 13%), radial-gradient(circle at 80% 20%, #f5e6c8 0 6%, transparent 7%), radial-gradient(circle at 35% 80%, #f5e6c8 0 7%, transparent 8%), repeating-linear-gradient(45deg, transparent 0 14px, rgba(255,255,255,0.06) 14px 16px)',
  },
  adire: {
    backgroundColor: '#1d3354',
    backgroundImage:
      'radial-gradient(circle, transparent 0 5px, #d6e0ef 5px 7px, transparent 7.5px), radial-gradient(circle, #d6e0ef 0 2px, transparent 2.5px), linear-gradient(90deg, transparent 0 46%, rgba(214,224,239,0.18) 46% 54%, transparent 54%)',
    backgroundSize: '28px 28px, 28px 28px, 28px 28px',
    backgroundPosition: '0 0, 14px 14px, 0 0',
  },
  lace: {
    backgroundColor: '#c99a3e',
    backgroundImage:
      'radial-gradient(circle, rgba(255,250,235,0.55) 0 1.5px, transparent 2.5px), radial-gradient(circle, rgba(255,250,235,0.25) 0 4px, transparent 5px)',
    backgroundSize: '9px 9px, 18px 18px',
  },
  gele: {
    backgroundColor: '#7a1f3d',
    backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.14) 0 3px, transparent 3px 10px)',
  },
  kaftan: {
    backgroundColor: '#e9dcc2',
    backgroundImage:
      'repeating-linear-gradient(90deg, rgba(17,33,26,0.09) 0 2px, transparent 2px 12px), linear-gradient(180deg, transparent 60%, rgba(14,107,71,0.25) 60% 66%, transparent 66%)',
  },
} as const;
export type Fabric = keyof typeof FABRICS;

export function Swatch({ fabric, className }: { fabric: Fabric; className?: string }) {
  return <span aria-hidden className={cn('block shrink-0', className)} style={FABRICS[fabric]} />;
}

function BrowserFrame({ url, children, className }: { url: string; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-[#d9d0bc] bg-card shadow-[0_1px_2px_rgba(17,33,26,0.06),0_30px_60px_-24px_rgba(17,33,26,0.28)]',
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b bg-muted/60 px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
        </div>
        <div className="mx-auto w-full max-w-[16rem] truncate rounded-full border bg-card px-3 py-1 text-center text-[11px] text-muted-foreground">{url}</div>
        <div className="w-10" aria-hidden />
      </div>
      {children}
    </div>
  );
}

function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[2rem] border border-[#d9d0bc] bg-[#11211a] p-[7px] shadow-[0_30px_60px_-20px_rgba(17,33,26,0.45)]',
        className,
      )}
    >
      <div className="relative overflow-hidden rounded-[1.6rem] bg-card text-card-foreground">
        <div aria-hidden className="absolute left-1/2 top-1.5 z-10 h-4 w-16 -translate-x-1/2 rounded-full bg-[#11211a]" />
        {children}
      </div>
    </div>
  );
}

/* ── the hero ──────────────────────────────────────────────────────────── */

/** The dashboard of the sample shop on a Tuesday afternoon. */
export function DashboardScreen() {
  const orders = [
    { ref: 'AF-1048', who: 'Chioma O.', where: 'Online', amount: '₦36,000', status: <Pill tone="green">Paid</Pill> },
    { ref: 'AF-1047', who: 'Walk-in', where: 'Ikeja store', amount: '₦12,500', status: <Pill tone="green">Paid</Pill> },
    { ref: 'AF-1046', who: 'Tunde A.', where: 'Online', amount: '₦54,000', status: <Pill tone="amber">Pay on delivery</Pill> },
    { ref: 'AF-1045', who: 'Halima B.', where: 'Online', amount: '₦18,500', status: <Pill tone="blue">On its way</Pill> },
  ];
  const bars = [38, 52, 44, 61, 48, 72, 66];
  return (
    <BrowserFrame url={`adaeze.${PLATFORM_DOMAIN}`}>
      <div className="flex" aria-hidden>
        <aside className="hidden w-36 shrink-0 border-r bg-muted/40 p-3 sm:block">
          <div className="mb-4 flex items-center gap-2 px-1">
            <Swatch fabric="ankara" className="size-5 rounded-md" />
            <span className="truncate text-[11px] font-semibold">Adaeze Fabrics</span>
          </div>
          {['Home', 'Orders', 'Customers', 'Products', 'Inventory', 'Online store', 'Reports'].map((item, i) => (
            <div
              key={item}
              className={cn('mb-0.5 rounded-md px-2 py-1.5 text-[11px]', i === 0 ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground')}
            >
              {item}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <p className="text-[13px] font-semibold">Good afternoon, Adaeze</p>
          <p className="mt-0.5 text-[10.5px] text-muted-foreground">23 orders so far today, across your three stores.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { label: 'Sales today', value: '₦184,500', note: '+₦41,000 on last Tue' },
              { label: 'Orders', value: '23', note: '9 online · 14 in store' },
              { label: 'Low stock', value: '4', note: '2 at Lekki' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border bg-card p-2.5">
                <p className="text-[9.5px] text-muted-foreground">{s.label}</p>
                <p className="mt-0.5 text-[14px] font-semibold tabular-nums tracking-tight">{s.value}</p>
                <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{s.note}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_7.5rem]">
            <div className="rounded-lg border bg-card">
              <div className="border-b px-3 py-2 text-[10.5px] font-semibold">Latest orders</div>
              <ul className="divide-y">
                {orders.map((o) => (
                  <li key={o.ref} className="flex items-center gap-2 px-3 py-2 text-[10px]">
                    <span className="w-12 shrink-0 font-mono text-muted-foreground">{o.ref}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {o.who} <span className="text-muted-foreground">· {o.where}</span>
                    </span>
                    <span className="w-14 text-right tabular-nums">{o.amount}</span>
                    <span className="hidden w-[5.5rem] text-right sm:block">{o.status}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden rounded-lg border bg-card p-3 md:block">
              <p className="text-[10.5px] font-semibold">Last 7 days</p>
              <div className="mt-3 flex h-[4.5rem] items-end gap-1">
                {bars.map((h, i) => (
                  <div key={i} className={cn('flex-1 rounded-[3px]', i === bars.length - 1 ? 'bg-primary' : 'bg-primary/20')} style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[9px] text-muted-foreground">
                <span>Wed</span>
                <span>Tue</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/** A product in the sample shop's online store, on a phone. */
export function PhoneShop({ className }: { className?: string }) {
  return (
    <PhoneFrame className={className}>
      <div aria-hidden>
        <div className="flex items-center justify-between px-4 pb-2 pt-7 text-[10px]">
          <span className="font-semibold text-foreground">Adaeze Fabrics</span>
          <span className="text-muted-foreground">Bag · 1</span>
        </div>
        <Swatch fabric="ankara" className="mx-3 aspect-[4/3] rounded-xl" />
        <div className="space-y-2.5 p-3.5">
          <div>
            <p className="text-[13px] font-semibold leading-tight">Ankara wrap dress</p>
            <p className="mt-0.5 text-[13px] font-semibold tabular-nums">₦18,500</p>
          </div>
          <div className="flex gap-1.5">
            {['S', 'M', 'L', 'XL'].map((s) => (
              <span
                key={s}
                className={cn('flex h-6 w-8 items-center justify-center rounded-md border text-[10px]', s === 'M' && 'border-foreground font-semibold')}
              >
                {s}
              </span>
            ))}
          </div>
          <div className="space-y-1 rounded-lg bg-muted/70 p-2 text-[9.5px]">
            <p className="flex items-center gap-1.5">
              <MapPin className="size-3 text-muted-foreground" />
              Ships from <span className="font-semibold">Lekki store</span>
            </p>
            <p className="flex items-center gap-1.5">
              <Truck className="size-3 text-muted-foreground" />
              <span className="tabular-nums">₦2,500</span> · 1–2 days to Ikeja
            </p>
          </div>
          <div className="flex h-8 items-center justify-center rounded-full bg-[#11211a] text-[11px] font-semibold text-white">Add to bag</div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** A floating card in the hero: one online payment, landed. */
export function PaidNotice({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('flex items-center gap-3 rounded-2xl border bg-card p-3 pr-4 shadow-[0_18px_40px_-16px_rgba(17,33,26,0.35)]', className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="size-4" strokeWidth={3} />
      </span>
      <div className="text-[11px] leading-snug">
        <p className="font-semibold text-foreground">Payment received · ₦36,000</p>
        <p className="text-muted-foreground">Order AF-1048, paid to your bank</p>
      </div>
    </div>
  );
}

/** A floating card in the hero: a low-stock warning for one branch. */
export function LowStockNotice({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('flex items-center gap-3 rounded-2xl border bg-card p-3 pr-4 shadow-[0_18px_40px_-16px_rgba(17,33,26,0.35)]', className)}>
      <Swatch fabric="lace" className="size-9 rounded-lg" />
      <div className="text-[11px] leading-snug">
        <p className="font-semibold text-foreground">Lace fabric is running low</p>
        <p className="text-muted-foreground">2 left at Ikeja · 18 at Lekki</p>
      </div>
    </div>
  );
}

/* ── the feature chapters ──────────────────────────────────────────────── */

/** Stock: one product list, counted in every branch. */
export function StockPreview() {
  const rows: { name: string; variant: string; fabric: Fabric; counts: [number, number, number] }[] = [
    { name: 'Ankara wrap dress', variant: 'Size M', fabric: 'ankara', counts: [12, 3, 7] },
    { name: 'Aso-oke gele', variant: 'Wine', fabric: 'gele', counts: [20, 14, 0] },
    { name: 'Adire kaftan', variant: 'Size L', fabric: 'adire', counts: [5, 9, 11] },
    { name: 'Lace fabric, 5 yards', variant: 'Gold', fabric: 'lace', counts: [2, 18, 6] },
  ];
  const cell = (n: number) => (
    <span
      className={cn(
        'inline-flex min-w-7 justify-center rounded-md px-1.5 py-0.5 tabular-nums',
        n === 0 ? 'bg-[#f9e2dc] font-semibold text-[#9b351c]' : n <= 3 ? 'bg-[#fbecd0] font-semibold text-[#8a5300]' : 'text-foreground',
      )}
    >
      {n}
    </span>
  );
  return (
    <figure className="overflow-hidden rounded-2xl border bg-card shadow-[0_24px_50px_-28px_rgba(17,33,26,0.35)]">
      <div aria-hidden>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-[13px] font-semibold">Stock by store</p>
          <Pill tone="amber">3 running low</Pill>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Product</th>
              <th className="px-1.5 py-2 text-right font-medium">Ikeja</th>
              <th className="px-1.5 py-2 text-right font-medium">Lekki</th>
              <th className="px-4 py-2 text-right font-medium">Abuja</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <Swatch fabric={r.fabric} className="size-8 rounded-md" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="text-[10.5px] text-muted-foreground">{r.variant}</span>
                    </span>
                  </span>
                </td>
                {r.counts.map((n, i) => (
                  <td key={i} className={cn('py-2.5 text-right', i === 2 ? 'px-4' : 'px-1.5')}>
                    {cell(n)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-2 border-t bg-mk-leaf/60 px-4 py-2.5 text-[11px]">
          <Truck className="size-3.5 text-primary" />
          <span className="text-muted-foreground">
            Moving 6 × Lace fabric from Lekki to Ikeja — <span className="font-semibold text-foreground">on its way</span>
          </span>
        </div>
      </div>
      <figcaption className="sr-only">An illustration of stock counted separately in three branches, with low stock marked and a transfer between stores.</figcaption>
    </figure>
  );
}

/** The online shop: the product page and the delivery options the shopper gets. */
export function StorefrontPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-md py-2">
      <PhoneShop className="mx-auto w-[15rem] sm:ml-[4%]" />
      <div
        aria-hidden
        className="absolute -right-2 bottom-6 hidden w-[13.5rem] rounded-2xl border bg-card p-3 text-[10.5px] shadow-[0_18px_40px_-16px_rgba(17,33,26,0.35)] sm:block"
      >
        <p className="font-semibold">Delivery to Ikeja, Lagos</p>
        <ul className="mt-2 space-y-1.5">
          {[
            { t: 'Standard · 1–2 days', p: '₦2,500', on: true },
            { t: 'Same day', p: '₦4,000', on: false },
            { t: 'Pick up at Lekki store', p: 'Free', on: false },
          ].map((o) => (
            <li key={o.t} className={cn('flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5', o.on && 'border-primary bg-mk-leaf/60')}>
              <span>{o.t}</span>
              <span className="font-semibold tabular-nums">{o.p}</span>
            </li>
          ))}
        </ul>
      </div>
      <div
        aria-hidden
        className="absolute -right-2 top-14 hidden rounded-2xl border bg-card px-3 py-2 text-[10.5px] shadow-[0_18px_40px_-16px_rgba(17,33,26,0.35)] sm:block"
      >
        <p className="text-muted-foreground">Your own domain</p>
        <p className="font-semibold">adaezefabrics.com.ng</p>
      </div>
      <figcaption className="sr-only">
        An illustration of a product in a merchant’s online shop, showing which store it ships from and the delivery options and prices for the shopper’s city.
      </figcaption>
    </figure>
  );
}

/** Money: one online payment, from the shopper to the merchant's bank. */
export function PayoutPreview() {
  return (
    <figure className="overflow-hidden rounded-2xl border bg-card shadow-[0_24px_50px_-28px_rgba(17,33,26,0.35)]">
      <div aria-hidden className="p-5">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <CreditCard className="size-4 text-muted-foreground" />
            Order AF-1048 · paid by card
          </p>
          <Pill tone="green">Paid</Pill>
        </div>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5 text-center">
          {[
            { label: 'Shopper pays', value: '₦45,000', strong: false },
            { label: 'Paystack’s fee', value: '−₦775', strong: false },
            { label: 'You receive', value: '₦44,225', strong: true },
          ].map((s, i) => (
            <div key={s.label} className="contents">
              {i > 0 && <span className="text-muted-foreground">→</span>}
              <div className={cn('rounded-xl border px-1.5 py-2.5', s.strong && 'border-primary bg-mk-leaf')}>
                <p className="text-[9.5px] text-muted-foreground">{s.label}</p>
                <p className={cn('mt-0.5 text-[13px] font-semibold tabular-nums', s.strong && 'text-primary')}>{s.value}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed px-3.5 py-2.5 text-[12px]">
          <span className="text-muted-foreground">{PLATFORM_NAME}’s commission</span>
          <span className="font-mk-display text-[17px] font-bold tabular-nums">₦0</span>
        </div>
        <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-muted/70 px-3.5 py-2.5 text-[11.5px]">
          <Landmark className="size-4 shrink-0 text-muted-foreground" />
          <span>
            Paid by Paystack to <span className="font-semibold">your bank account ••4821</span>
          </span>
          <Check className="ml-auto size-4 text-primary" strokeWidth={3} />
        </div>
      </div>
      <figcaption className="sr-only">
        An illustration of an online payment: what the shopper paid, Paystack’s fee, no commission, and what the merchant receives in their own bank account.
      </figcaption>
    </figure>
  );
}

/** Social: one product posted to the shop's Facebook Page and Instagram. */
export function SocialPreview() {
  return (
    <figure className="overflow-hidden rounded-2xl border bg-card shadow-[0_24px_50px_-28px_rgba(17,33,26,0.35)]">
      <div aria-hidden className="grid sm:grid-cols-[11rem_1fr]">
        <Swatch fabric="adire" className="aspect-square sm:aspect-auto sm:h-full" />
        <div className="p-4">
          <p className="text-[13px] font-semibold">New post · Adire kaftan</p>
          <div className="mt-2.5 rounded-xl border bg-muted/40 p-3 text-[11.5px] leading-relaxed">
            Hand-dyed adire kaftan in deep indigo, cut loose for Lagos heat. Sizes M to XL, ₦24,000.
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">Caption drafted from your product’s details. You edit it, you press Publish.</p>
          <ul className="mt-3 space-y-1.5 text-[11.5px]">
            {['Facebook Page', 'Instagram'].map((p) => (
              <li key={p} className="flex items-center justify-between rounded-lg border px-2.5 py-1.5">
                <span className="font-medium">{p}</span>
                <Pill tone="green">Published</Pill>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <figcaption className="sr-only">An illustration of a product being posted to a shop’s Facebook Page and Instagram account, with a caption drafted from the product’s details.</figcaption>
    </figure>
  );
}

/* ── small pictures for the "everything else" grid ─────────────────────── */

export function CounterMini() {
  return (
    <div aria-hidden className="mx-auto w-full max-w-[13rem] rounded-t-xl border border-b-0 bg-card px-3.5 pb-2 pt-3 text-[10.5px] shadow-sm">
      <p className="flex items-center justify-between font-semibold">
        <span className="flex items-center gap-1.5">
          <Receipt className="size-3.5 text-primary" /> Ikeja store
        </span>
        <span className="font-mono text-[9.5px] font-normal text-muted-foreground">#R-2291</span>
      </p>
      <div className="mt-2 space-y-1 border-y border-dashed py-2 text-muted-foreground">
        <p className="flex justify-between">
          <span>Adire kaftan × 1</span>
          <span className="tabular-nums text-foreground">₦24,000</span>
        </p>
        <p className="flex justify-between">
          <span>Aso-oke gele × 2</span>
          <span className="tabular-nums text-foreground">₦15,000</span>
        </p>
      </div>
      <p className="mt-1.5 flex justify-between font-semibold">
        <span>Total</span>
        <span className="tabular-nums">₦39,000</span>
      </p>
    </div>
  );
}

export function ChatMini() {
  return (
    <div aria-hidden className="mx-auto w-full max-w-[14rem] space-y-1.5 text-[10.5px]">
      <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-md border bg-card px-3 py-2 shadow-sm">Do you have the gele in wine?</p>
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground">
        Yes — 14 at our Lekki store. Delivery to Yaba is ₦2,500.
      </p>
      <p className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
        <MessageCircle className="size-3" /> Replied from your phone
      </p>
    </div>
  );
}

export function InvoiceMini() {
  return (
    <div aria-hidden className="mx-auto w-full max-w-[13.5rem] rounded-xl border bg-card p-3 text-[10.5px] shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Invoice INV-0213</span>
        <Pill tone="amber">Partially paid</Pill>
      </div>
      <p className="mt-1 text-muted-foreground">Bisi Events Ltd · due 30 Nov</p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-3/5 rounded-full bg-primary" />
      </div>
      <p className="mt-1.5 flex justify-between tabular-nums">
        <span>₦144,000 paid</span>
        <span className="text-muted-foreground">of ₦240,000</span>
      </p>
    </div>
  );
}

export function AlertMini() {
  return (
    <div aria-hidden className="mx-auto w-full max-w-[14rem] space-y-1.5 text-[10.5px]">
      {[
        { t: 'New order · ₦36,000', d: 'Chioma O. · paid online', when: 'now' },
        { t: 'Lace fabric is running low', d: '2 left at Ikeja', when: '12m' },
      ].map((n, i) => (
        <div key={n.t} className={cn('flex items-start gap-2 rounded-xl border bg-card/90 p-2.5 shadow-sm', i === 1 && 'opacity-70')}>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bell className="size-3" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{n.t}</span>
            <span className="block truncate text-muted-foreground">{n.d}</span>
          </span>
          <span className="text-[9px] text-muted-foreground">{n.when}</span>
        </div>
      ))}
    </div>
  );
}

export function TeamMini() {
  return (
    <ul aria-hidden className="mx-auto w-full max-w-[14rem] divide-y rounded-xl border bg-card text-[10.5px] shadow-sm">
      {[
        { n: 'Adaeze', r: 'Owner', c: 'bg-primary text-primary-foreground' },
        { n: 'Musa', r: 'Ikeja store only', c: 'bg-mk-sun text-[#11211a]' },
        { n: 'Bisi', r: 'Lekki store only', c: 'bg-[#22375a] text-white' },
      ].map((m) => (
        <li key={m.n} className="flex items-center gap-2 px-3 py-2">
          <span className={cn('flex size-6 items-center justify-center rounded-full text-[10px] font-bold', m.c)}>{m.n[0]}</span>
          <span className="font-semibold">{m.n}</span>
          <span className="ml-auto flex items-center gap-1 text-muted-foreground">
            {m.r !== 'Owner' && <Store className="size-3" />}
            {m.r}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ReportMini() {
  const bars = [30, 42, 36, 55, 48, 64, 58, 72, 66, 80];
  return (
    <div aria-hidden className="mx-auto w-full max-w-[14rem] rounded-xl border bg-card p-3 text-[10.5px] shadow-sm">
      <p className="text-muted-foreground">Profit this month</p>
      <p className="font-mk-display text-[17px] font-bold tabular-nums">₦412,800</p>
      <div className="mt-2 flex h-12 items-end gap-1">
        {bars.map((h, i) => (
          <span key={i} className={cn('flex-1 rounded-[2px]', i === bars.length - 1 ? 'bg-mk-sun' : 'bg-primary/25')} style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

/* ── the store's own app (ROADMAP 16) ──────────────────────────────────── */

/** The sample shop's own app: its home screen, its icon, and an order update arriving as a notification. */
export function ShopperAppPreview() {
  const products: { name: string; price: string; fabric: Fabric }[] = [
    { name: 'Ankara wrap dress', price: '₦18,500', fabric: 'ankara' },
    { name: 'Adire kaftan', price: '₦24,000', fabric: 'adire' },
    { name: 'Aso-oke gele', price: '₦7,500', fabric: 'gele' },
    { name: 'Lace fabric', price: '₦32,000', fabric: 'lace' },
  ];
  return (
    <figure className="relative mx-auto w-full max-w-md py-4">
      <PhoneFrame className="mx-auto w-[15rem]">
        <div aria-hidden>
          <div className="flex items-center justify-between px-4 pb-2.5 pt-7">
            <span className="flex items-center gap-1.5">
              <Swatch fabric="ankara" className="size-5 rounded-md" />
              <span className="text-[11px] font-semibold">Adaeze Fabrics</span>
            </span>
            <span className="text-[10px] text-muted-foreground">Bag · 0</span>
          </div>
          <div className="mx-3 rounded-xl bg-[#11211a] px-3 py-3 text-white">
            <p className="text-[9px] uppercase tracking-[0.12em] text-white/60">New in</p>
            <p className="mt-0.5 text-[13px] font-semibold leading-tight">Hand-dyed adire, cut for Lagos heat</p>
          </div>
          <ul className="grid grid-cols-2 gap-2 p-3">
            {products.map((p) => (
              <li key={p.name}>
                <Swatch fabric={p.fabric} className="aspect-square rounded-lg" />
                <p className="mt-1 truncate text-[9.5px] font-medium">{p.name}</p>
                <p className="text-[9.5px] font-semibold tabular-nums">{p.price}</p>
              </li>
            ))}
          </ul>
          <div className="flex justify-around border-t py-2 text-[8.5px] text-muted-foreground">
            {['Home', 'Shop', 'Bag', 'Account'].map((t, i) => (
              <span key={t} className={cn(i === 0 && 'font-semibold text-foreground')}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </PhoneFrame>

      <div
        aria-hidden
        className="absolute -right-1 -top-2 hidden w-56 items-start gap-2.5 rounded-2xl border border-white/40 bg-white/95 p-3 text-[10.5px] text-[#11211a] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.45)] sm:flex"
      >
        <Swatch fabric="ankara" className="size-8 rounded-[9px]" />
        <span className="min-w-0">
          <span className="flex justify-between gap-2">
            <span className="font-semibold">Adaeze Fabrics</span>
            <span className="text-[9.5px] text-[#58645d]">now</span>
          </span>
          <span className="block text-[#3d4943]">Your order AF-1048 is on its way.</span>
        </span>
      </div>

      <div aria-hidden className="absolute -left-1 bottom-10 hidden flex-col items-center gap-1.5 sm:flex">
        <span className="rounded-[1.1rem] bg-white/10 p-2 ring-1 ring-white/15">
          <Swatch fabric="ankara" className="size-14 rounded-[0.9rem] shadow-lg" />
        </span>
        <span className="text-[11px] font-medium text-white/90">Adaeze Fabrics</span>
      </div>

      <figcaption className="sr-only">
        An illustration of a sample shop’s own phone app: its home screen with products, its icon on a phone, and an order update arriving as a
        notification.
      </figcaption>
    </figure>
  );
}

/* ── the shopping assistant and search with an image ───────────────────── */

/** A shopper asking the store's shopping assistant, and a photo search beside it. */
export function AssistantPreview() {
  const picks: { name: string; note: string; price: string; fabric: Fabric }[] = [
    { name: 'Ankara wrap dress', note: 'Sizes S–XL · in stock', price: '₦18,500', fabric: 'ankara' },
    { name: 'Ankara peplum top', note: 'Sizes M–L · 4 left', price: '₦14,000', fabric: 'gele' },
  ];
  return (
    <figure className="grid gap-3">
      <div aria-hidden className="overflow-hidden rounded-2xl border bg-card shadow-[0_24px_50px_-28px_rgba(17,33,26,0.35)]">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <MessageCircle className="size-3.5" />
          </span>
          <p className="text-[13px] font-semibold">Shopping assistant</p>
        </div>
        <div className="space-y-2.5 p-4 text-[11.5px]">
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[#11211a] px-3 py-2 text-white">
            Something in ankara for a wedding, under ₦20,000?
          </p>
          <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-3 py-2">Two in this shop fit that:</p>
          <ul className="space-y-1.5">
            {picks.map((p) => (
              <li key={p.name} className="flex items-center gap-2.5 rounded-xl border p-2">
                <Swatch fabric={p.fabric} className="size-10 rounded-lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block text-[10.5px] text-muted-foreground">{p.note}</span>
                </span>
                <span className="font-semibold tabular-nums">{p.price}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div aria-hidden className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-[0_18px_40px_-24px_rgba(17,33,26,0.35)]">
        <span className="relative shrink-0">
          <Swatch fabric="adire" className="size-14 rounded-xl" />
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#11211a] px-1.5 py-0.5 text-[8.5px] font-semibold text-white">
            Your photo
          </span>
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-semibold">Search with an image</span>
          <span className="block text-[10.5px] text-muted-foreground">3 similar in this shop</span>
        </span>
        <span className="flex gap-1.5">
          {(['adire', 'kaftan', 'ankara'] as Fabric[]).map((f) => (
            <Swatch key={f} fabric={f} className="size-9 rounded-lg" />
          ))}
        </span>
      </div>
      <figcaption className="sr-only">
        An illustration of a shopper asking a store’s shopping assistant for an ankara outfit under a budget and getting two of the store’s own products back, and of a
        photo search finding three similar products in the same store.
      </figcaption>
    </figure>
  );
}
