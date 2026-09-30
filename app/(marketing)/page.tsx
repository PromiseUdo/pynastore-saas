/*
 * The public front page (ROADMAP 12.3), on the platform host. Signed-in
 * visitors never see it: proxy.ts sends them to their shop's dashboard (or
 * to /onboarding) before this renders.
 *
 * Every claim here is something the product does today. Numbers that can
 * change — the trial, the cheapest plan, the grace period — are read from
 * the plan catalogue and billing settings (lib/marketing/offer.ts), the
 * same places the app uses. No testimonials, customer counts or logos: we
 * don't have any we could stand behind yet.
 */
import type { Metadata } from 'next';
import {
  Boxes,
  FileText,
  Megaphone,
  LineChart,
  Receipt,
  Share2,
  ShoppingBag,
  Store,
  Truck,
  Undo2,
  Users,
  UserCog,
} from 'lucide-react';
import { PLATFORM_CONTACT_EMAIL, PLATFORM_DOMAIN, PLATFORM_NAME } from '@/lib/brand';
import { formatMoney } from '@/lib/format';
import { getPublicOffer } from '@/lib/marketing/offer';
import { PrimaryCta, SecondaryCta } from '@/components/marketing/cta';
import { Faq, type FaqItem } from '@/components/marketing/faq';
import { DashboardPreview, PayoutPreview, StockPreview, StorefrontPreview } from '@/components/marketing/product-visuals';

export const revalidate = 600;

export const metadata: Metadata = {
  title: { absolute: `${PLATFORM_NAME} — run your shop, in store and online` },
  description: `Stock, sales, delivery and payments for businesses that sell at a counter, online, or both. Online payments go straight to your bank, and ${PLATFORM_NAME} takes no commission on your sales.`,
  alternates: { canonical: '/' },
  openGraph: {
    title: `${PLATFORM_NAME} — run your shop, in store and online`,
    description: 'Stock, sales, delivery and payments in one place. No commission on your sales.',
    type: 'website',
  },
};

export default async function HomePage() {
  const offer = await getPublicOffer();
  const trial = offer.trialDays > 0 ? `${offer.trialDays}-day free trial` : null;

  const faq: FaqItem[] = [
    {
      q: 'Do I need a card to start?',
      a: trial
        ? `No. You get a ${trial}${offer.trialPlanName ? ` of ${offer.trialPlanName}` : ''} without a card. You only pay if you choose a plan.`
        : 'No card is needed to create your shop. You pay when you choose a plan.',
    },
    {
      q: `Does ${PLATFORM_NAME} take a cut of my sales?`,
      a: `No. Your plan is the only thing you pay us. Online payments are handled by Paystack, which pays you directly into your own bank account and charges its standard fee — ${PLATFORM_NAME} never holds your money.`,
    },
    {
      q: 'What happens when my trial ends?',
      a:
        offer.graceDays && offer.graceDays > 0
          ? `Choose a plan and everything carries on. If you don’t, your shop keeps taking orders for ${offer.graceDays} more days, then pauses until you do. Nothing is deleted.`
          : 'Choose a plan and everything carries on. If you don’t, your shop pauses until you do. Nothing is deleted.',
    },
    {
      q: 'I have more than one branch. Does it handle that?',
      a: 'Yes. Each store keeps its own stock, and every sale comes off the store it was sold from — online orders come from the store that can deliver. You can move stock between stores and limit staff to the stores they work in.',
    },
    {
      q: 'How do my customers pay online?',
      a: 'By card or bank transfer through Paystack, or you can offer pay on delivery. You can also show your own account details for customers who prefer to transfer directly.',
    },
    {
      q: 'Can I use my own web address?',
      a: `Your shop starts at shop-yourname.${PLATFORM_DOMAIN}. On a paid plan you can buy a .com through us — registered in your business’s name — or connect a domain you already own. It’s usually ready within 24 hours.`,
    },
    {
      q: 'I already keep my products in a spreadsheet.',
      a: 'Import it. Up to 500 rows at a time, with sizes and colours as variants and the stock in each of your stores. You see exactly what will be added before anything is saved.',
    },
    {
      q: 'Who owns my data?',
      a: 'You do. Your products, customers and orders are yours, and you can export your lists as spreadsheets from the dashboard.',
    },
  ];

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-gradient-to-b from-muted/60 to-transparent" />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-primary">For shops, boutiques and stores across Nigeria</p>
            <h1 className="text-balance mt-4 text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.035em] text-foreground sm:text-6xl">
              Your shop, in store and online, run from one place.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              {PLATFORM_NAME} keeps your stock, sales, deliveries and payments together — so what you sell at the counter
              and what you sell online come off the same shelf, and online payments go straight to your bank.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <PrimaryCta href="/register">{trial ? `Start your ${trial}` : 'Create your shop'}</PrimaryCta>
              <SecondaryCta href="/pricing">See pricing</SecondaryCta>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
              {['No card needed', 'No commission on your sales', 'Your data stays yours'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span aria-hidden className="size-1 rounded-full bg-muted-foreground/60" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-16">
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* ── Where it sells ───────────────────────────────────────────── */}
      <section aria-label="Where you can sell" className="border-y bg-muted/20">
        <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 sm:px-6 md:grid-cols-4">
          {[
            { icon: Store, text: 'At your counter' },
            { icon: ShoppingBag, text: 'On your own website' },
            { icon: Share2, text: 'On Facebook and Instagram' },
            { icon: Truck, text: 'With delivery to any state' },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 py-6 text-sm font-medium text-foreground">
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section id="features" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-balance text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">Built around how shops here actually sell.</h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Most shops sell in more than one way. {PLATFORM_NAME} keeps them all on the same stock and the same books.
            </p>
          </div>

          <div className="mt-16 space-y-20 sm:mt-20 sm:space-y-28">
            <FeatureRow
              kicker="Stock"
              title="Know what’s on every shelf, in every branch."
              body="Each store keeps its own count, and every sale — at the counter or online — comes off the right one. Move stock between branches, count it, and get told when something runs low, store by store."
              points={[
                'Sizes, colours and materials as variants',
                'Transfers between stores, tracked until they arrive',
                'Stock counts that show what’s gone missing',
                'Bring your products in from a spreadsheet',
              ]}
              visual={<StockPreview />}
            />
            <FeatureRow
              reverse
              kicker="Online shop"
              title="A shop that knows where it ships from."
              body={`Your products go online at your own address — shop-yourname.${PLATFORM_DOMAIN}, or your own .com. Delivery is priced from the store that has the stock to the shopper’s state and city, at the rates you set.`}
              points={[
                'Delivery zones by state and city, and pickup points',
                'Card, bank transfer and pay on delivery',
                'Reviews only from people who actually bought',
                'Shows “Opening soon” until you’re ready',
              ]}
              visual={<StorefrontPreview />}
            />
            <FeatureRow
              kicker="Getting paid"
              title="Online payments go straight to your bank."
              body={`Paystack pays you directly into your own account. ${PLATFORM_NAME} never holds your money and doesn’t take a cut of your sales — your plan is the only thing you pay us. Paystack’s standard fee applies.`}
              points={[
                'Your business is checked once, then payments flow',
                'Every payment shows what Paystack took and what you got',
                'Chargebacks flagged on the order, with the deadline',
              ]}
              visual={<PayoutPreview />}
            />
          </div>
        </div>
      </section>

      {/* ── The rest of the day-to-day ───────────────────────────────── */}
      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <h2 className="text-balance max-w-2xl text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">And the rest of the day-to-day.</h2>
          <dl className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Receipt, t: 'Counter sales', d: 'Sell in person from the same stock, and hand over a receipt.' },
              { icon: FileText, t: 'Quotes and invoices', d: 'Send a quote, turn it into an invoice, and record what’s paid.' },
              { icon: Users, t: 'Customers', d: 'Every customer’s orders and what they’ve spent, in one place.' },
              { icon: Boxes, t: 'Purchasing', d: 'Suppliers, purchase orders, and restocking drafted from what’s running low.' },
              { icon: UserCog, t: 'Team and roles', d: 'Invite staff and decide what each can do — down to which store.' },
              { icon: Megaphone, t: 'Facebook and Instagram', d: 'Post products to your Page and Instagram, with a caption drafted from your own details.' },
              { icon: Undo2, t: 'Returns', d: 'Cancellations and returns handled from the order they belong to.' },
              { icon: LineChart, t: 'Reports', d: 'Sales, profit, and what sells in which store — as spreadsheets too.' },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t}>
                <dt className="flex items-center gap-2.5 text-[15px] font-semibold">
                  <Icon className="size-4 text-primary" aria-hidden />
                  {t}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-20 border-t">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <h2 className="text-balance text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">From sign-up to your first order.</h2>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                A short checklist in your dashboard shows what’s left, and your shop stays closed to customers until you open it.
              </p>
            </div>
            <ol className="space-y-px overflow-hidden rounded-xl border bg-border">
              {[
                {
                  t: 'Create your shop',
                  d: 'Choose your web address and tell us where your first store is. It takes a couple of minutes.',
                },
                {
                  t: 'Add your products',
                  d: 'One at a time with photos and sizes — or all at once from a spreadsheet, with the stock in each store.',
                },
                {
                  t: 'Set up delivery and payments',
                  d: 'Say where you deliver and what it costs, and how you’d like to be paid. Pay on delivery works from day one.',
                },
                { t: 'Open your shop', d: 'When everything’s ready, open it. Share the link, post to Instagram, and take your first order.' },
              ].map((step, i) => (
                <li key={step.t} className="flex gap-5 bg-background p-6">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums text-foreground">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold">{step.t}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────── */}
      <section className="border-t bg-foreground text-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-20 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 className="text-balance text-3xl font-semibold tracking-[-0.025em]">
              {offer.fromMonthly ? `Plans from ${formatMoney(offer.fromMonthly)} a month.` : 'Simple monthly plans.'}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-background/70">
              No commission on your sales, on any plan. Pay monthly, every six months or yearly — the longer you pay for, the less
              it costs.
            </p>
          </div>
          <a
            href="/pricing"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/60"
          >
            Compare plans
          </a>
        </div>
      </section>

      {/* ── Questions ────────────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-20">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <h2 className="text-balance text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">Questions shop owners ask.</h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Something else?{' '}
              <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="font-medium text-foreground underline underline-offset-4">
                Write to us
              </a>
              .
            </p>
          </div>
          <Faq items={faq} />
        </div>
      </section>

      {/* ── Last word ────────────────────────────────────────────────── */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-24 text-center sm:px-6">
          <h2 className="text-balance mx-auto max-w-2xl text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
            {trial ? `Try it with your own products for ${offer.trialDays} days.` : 'Set your shop up this week.'}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {trial
              ? `No card needed. Everything on ${offer.trialPlanName ?? 'the trial'} is included while you decide.`
              : 'Create your shop in a couple of minutes and follow the checklist.'}
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <PrimaryCta href="/register">{trial ? 'Start your free trial' : 'Create your shop'}</PrimaryCta>
            <SecondaryCta href="/pricing">See pricing</SecondaryCta>
          </div>
        </div>
      </section>
    </>
  );
}

function FeatureRow({
  kicker,
  title,
  body,
  points,
  visual,
  reverse = false,
}: {
  kicker: string;
  title: string;
  body: string;
  points: string[];
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
      <div className={reverse ? 'lg:order-2' : undefined}>
        <p className="text-sm font-medium text-primary">{kicker}</p>
        <h3 className="text-balance mt-3 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{title}</h3>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">{body}</p>
        <ul className="mt-6 space-y-2.5">
          {points.map((p) => (
            <li key={p} className="flex gap-3 text-[15px] text-foreground">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={reverse ? 'lg:order-1' : undefined}>{visual}</div>
    </div>
  );
}
