/*
 * Product visuals for the public site (ROADMAP 12.3) — drawn in HTML with
 * the dashboard's own look (tokens, badges, table rhythm) rather than
 * screenshots, so they stay true to the product as it changes and work in
 * both themes. The shop, products and figures are an illustration: a
 * sample fabric shop, not a customer.
 */
import { Check, CreditCard, Landmark, MapPin, Package, Truck } from 'lucide-react';
import { PLATFORM_DOMAIN, PLATFORM_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';

const Pill = ({ tone, children }: { tone: 'green' | 'amber' | 'blue' | 'slate'; children: React.ReactNode }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium',
      tone === 'green' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      tone === 'amber' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
      tone === 'blue' && 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
      tone === 'slate' && 'bg-muted text-muted-foreground',
    )}
  >
    {children}
  </span>
);

function BrowserFrame({ url, children, className }: { url: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_40px_-12px_rgba(15,23,42,0.18)]', className)}>
      <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
        </div>
        <div className="mx-auto w-full max-w-xs truncate rounded-md border bg-background px-3 py-1 text-center text-[11px] text-muted-foreground">{url}</div>
        <div className="w-10" aria-hidden />
      </div>
      {children}
    </div>
  );
}

/** The hero: the dashboard of a sample shop on a Tuesday afternoon. */
export function DashboardPreview() {
  const orders = [
    { ref: 'AF-1048', who: 'Chioma O.', where: 'Online', amount: '₦36,000', status: <Pill tone="green">Paid</Pill> },
    { ref: 'AF-1047', who: 'Walk-in', where: 'Ikeja store', amount: '₦12,500', status: <Pill tone="green">Paid</Pill> },
    { ref: 'AF-1046', who: 'Tunde A.', where: 'Online', amount: '₦54,000', status: <Pill tone="amber">Pay on delivery</Pill> },
    { ref: 'AF-1045', who: 'Halima B.', where: 'Online', amount: '₦18,500', status: <Pill tone="blue">Sent</Pill> },
  ];
  const bars = [38, 52, 44, 61, 48, 72, 66];
  return (
    <figure>
      <BrowserFrame url={`adaeze.${PLATFORM_DOMAIN}/dashboard`}>
        <div className="flex">
          <aside className="hidden w-40 shrink-0 border-r bg-muted/30 p-3 sm:block" aria-hidden>
            <div className="mb-4 flex items-center gap-2 px-1">
              <span className="flex size-5 items-center justify-center rounded bg-foreground text-[9px] font-bold text-background">A</span>
              <span className="truncate text-[11px] font-semibold">Adaeze Fabrics</span>
            </div>
            {['Dashboard', 'Orders', 'Products', 'Stores', 'Customers', 'Delivery', 'Payments'].map((item, i) => (
              <div
                key={item}
                className={cn('mb-0.5 rounded-md px-2 py-1.5 text-[11px]', i === 0 ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground')}
              >
                {item}
              </div>
            ))}
          </aside>
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-semibold">Today</p>
              <p className="text-[10.5px] text-muted-foreground">All stores</p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {[
                { label: 'Sales', value: '₦184,500', note: '+ ₦41,000 vs last Tue' },
                { label: 'Orders', value: '23', note: '9 online · 14 in store' },
                { label: 'Low stock', value: '4', note: '2 at Lekki' },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border bg-background p-2.5">
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular-nums tracking-tight">{s.value}</p>
                  <p className="mt-0.5 truncate text-[9.5px] text-muted-foreground">{s.note}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-2.5 md:grid-cols-[1fr_9rem]">
              <div className="rounded-lg border bg-background">
                <div className="border-b px-3 py-2 text-[11px] font-medium">Latest orders</div>
                <ul className="divide-y">
                  {orders.map((o) => (
                    <li key={o.ref} className="flex items-center gap-2 px-3 py-2 text-[10.5px]">
                      <span className="w-14 shrink-0 font-mono text-muted-foreground">{o.ref}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {o.who} <span className="text-muted-foreground">· {o.where}</span>
                      </span>
                      <span className="w-16 text-right tabular-nums">{o.amount}</span>
                      <span className="hidden w-24 text-right sm:block">{o.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="hidden rounded-lg border bg-background p-3 md:block">
                <p className="text-[11px] font-medium">This week</p>
                <div className="mt-3 flex h-20 items-end gap-1.5" aria-hidden>
                  {bars.map((h, i) => (
                    <div key={i} className={cn('flex-1 rounded-sm', i === bars.length - 2 ? 'bg-primary' : 'bg-primary/25')} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="mt-1.5 flex justify-between text-[9px] text-muted-foreground">
                  <span>Mon</span>
                  <span>Sun</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </BrowserFrame>
      <figcaption className="sr-only">An illustration of the {PLATFORM_NAME} dashboard for a sample fabric shop: today’s sales, orders from the shop and online, and low stock.</figcaption>
    </figure>
  );
}

/** Stock: one product list, counted in every branch. */
export function StockPreview() {
  const rows = [
    { name: 'Ankara wrap dress', variant: 'Size M', ikeja: 12, lekki: 3, abuja: 7 },
    { name: 'Aso-oke gele', variant: 'Wine', ikeja: 20, lekki: 14, abuja: 0 },
    { name: 'Adire kaftan', variant: 'Size L', ikeja: 5, lekki: 9, abuja: 11 },
    { name: 'Lace fabric, 5 yards', variant: 'Gold', ikeja: 2, lekki: 18, abuja: 6 },
  ];
  const cell = (n: number) => (
    <span className={cn('tabular-nums', n === 0 ? 'text-destructive' : n <= 3 ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-foreground')}>{n}</span>
  );
  return (
    <figure className="rounded-xl border bg-card p-1.5 shadow-sm">
      <div className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-[13px] font-semibold">Stock by store</p>
          <Pill tone="amber">3 running low</Pill>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Product</th>
              <th className="px-2 py-2 text-right font-medium">Ikeja</th>
              <th className="px-2 py-2 text-right font-medium">Lekki</th>
              <th className="px-4 py-2 text-right font-medium">Abuja</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="px-4 py-2.5">
                  <span className="block font-medium">{r.name}</span>
                  <span className="text-[10.5px] text-muted-foreground">{r.variant}</span>
                </td>
                <td className="px-2 py-2.5 text-right">{cell(r.ikeja)}</td>
                <td className="px-2 py-2.5 text-right">{cell(r.lekki)}</td>
                <td className="px-4 py-2.5 text-right">{cell(r.abuja)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
          <Truck className="size-3.5" aria-hidden />
          Transfer 6 × Lace fabric from Lekki to Ikeja — <span className="font-medium text-foreground">on its way</span>
        </div>
      </div>
      <figcaption className="sr-only">An illustration of stock counted separately in three branches, with low stock marked and a transfer between stores.</figcaption>
    </figure>
  );
}

/** The online shop: a product page that already knows where it ships from. */
export function StorefrontPreview() {
  return (
    <figure className="mx-auto w-full max-w-[20rem] rounded-[1.75rem] border bg-card p-2 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.25)]">
      <div className="overflow-hidden rounded-[1.35rem] border bg-background">
        <div className="flex items-center justify-between px-4 pb-2 pt-3 text-[10px] text-muted-foreground">
          <span className="font-semibold text-foreground">Adaeze Fabrics</span>
          <span>shop-adaeze.{PLATFORM_DOMAIN}</span>
        </div>
        <div
          aria-hidden
          className="mx-3 aspect-[4/3] rounded-xl"
          style={{
            backgroundColor: '#1f3a5f',
            backgroundImage:
              'radial-gradient(circle at 20% 30%, #e8a33d 0 9%, transparent 10%), radial-gradient(circle at 70% 65%, #c2410c 0 12%, transparent 13%), radial-gradient(circle at 80% 20%, #f5e6c8 0 6%, transparent 7%), radial-gradient(circle at 35% 80%, #f5e6c8 0 7%, transparent 8%), repeating-linear-gradient(45deg, transparent 0 14px, rgba(255,255,255,0.06) 14px 16px)',
          }}
        />
        <div className="space-y-3 p-4">
          <div>
            <p className="text-[14px] font-semibold">Ankara wrap dress</p>
            <p className="mt-0.5 text-[15px] font-semibold tabular-nums">₦18,500</p>
          </div>
          <div className="flex gap-1.5">
            {['S', 'M', 'L', 'XL'].map((s) => (
              <span key={s} className={cn('flex h-7 w-9 items-center justify-center rounded-md border text-[11px]', s === 'M' && 'border-foreground font-semibold')}>
                {s}
              </span>
            ))}
          </div>
          <div className="space-y-1.5 rounded-lg bg-muted/50 p-2.5 text-[10.5px]">
            <p className="flex items-center gap-1.5">
              <MapPin className="size-3 text-muted-foreground" aria-hidden />
              Ships from <span className="font-medium">Lekki store</span>
            </p>
            <p className="flex items-center gap-1.5">
              <Truck className="size-3 text-muted-foreground" aria-hidden />
              <span className="tabular-nums">₦2,500</span> · 1–2 days to Ikeja, Lagos
            </p>
          </div>
          <div className="flex h-9 items-center justify-center rounded-lg bg-foreground text-[12px] font-medium text-background">Add to bag</div>
          <p className="text-center text-[10px] text-muted-foreground">Card · Bank transfer · Pay on delivery</p>
        </div>
      </div>
      <figcaption className="sr-only">An illustration of a product in a merchant’s online shop, showing which store it ships from and the delivery price to the shopper’s city.</figcaption>
    </figure>
  );
}

/** Money: one online payment, from the shopper to the merchant's bank. */
export function PayoutPreview() {
  const lines = [
    { label: 'Order AF-1048, paid by card', value: '₦45,000' },
    { label: 'Paystack’s fee (example)', value: '− ₦775' },
    { label: `${PLATFORM_NAME}’s commission`, value: '₦0' },
  ];
  return (
    <figure className="rounded-xl border bg-card p-1.5 shadow-sm">
      <div className="rounded-lg border bg-background p-5">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <CreditCard className="size-4 text-muted-foreground" aria-hidden />
            Online payment
          </p>
          <Pill tone="green">Paid</Pill>
        </div>
        <dl className="mt-4 space-y-2.5 text-[12.5px]">
          {lines.map((l) => (
            <div key={l.label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{l.label}</dt>
              <dd className="tabular-nums">{l.value}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t pt-3 text-[13.5px] font-semibold">
            <dt>You receive</dt>
            <dd className="tabular-nums">₦44,225</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5 text-[11px]">
          <Landmark className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            Paid by Paystack to <span className="font-medium">your bank account ••4821</span>
          </span>
          <Check className="ml-auto size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        </div>
      </div>
      <figcaption className="sr-only">An illustration of an online payment: the order total, Paystack’s fee, no commission, and what the merchant receives in their own bank account.</figcaption>
    </figure>
  );
}

/** A small tile for the counter: the same stock, sold in person. */
export function CounterPreview() {
  return (
    <div className="rounded-lg border bg-background p-3 text-[11px]" aria-hidden>
      <div className="flex items-center justify-between">
        <span className="font-medium">Counter sale · Ikeja</span>
        <Package className="size-3.5 text-muted-foreground" />
      </div>
      <div className="mt-2 flex justify-between text-muted-foreground">
        <span>Adire kaftan × 1</span>
        <span className="tabular-nums text-foreground">₦12,500</span>
      </div>
    </div>
  );
}
