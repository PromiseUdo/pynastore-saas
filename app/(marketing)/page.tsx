/*
 * The public front page (ROADMAP 12.3, redesigned in 23), on the platform
 * host. Signed-in visitors never see it: proxy.ts sends them to their shop's
 * dashboard (or to /onboarding) before this renders.
 *
 * Every claim here is something the product does today. Numbers that can
 * change — the trial, the plans and their prices, the grace period — are
 * read from the plan catalogue and billing settings (lib/marketing/offer.ts,
 * lib/billing/catalogue.ts), the same places the app uses. No testimonials,
 * customer counts or logos: we don't have any we could stand behind yet.
 * The screens are drawn illustrations of a sample shop, and say so; the
 * photos are of models (components/marketing/photo-scenes.tsx), with the
 * product's cards floating around them.
 *
 * The page reads top to bottom as: what it is → how it fits together → the
 * facts → the four big jobs → everything else → how to start → what it
 * costs → questions → start.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Globe,
  ImageIcon,
  MessageCircle,
  Smartphone,
} from 'lucide-react';
import {
  PLATFORM_DOMAIN,
  PLATFORM_NAME,
  PLATFORM_SUPPORT_EMAIL,
} from '@/lib/brand';
import { formatMoney } from '@/lib/format';
import { getPublicOffer, orList } from '@/lib/marketing/offer';
import { getDemoShopUrl } from '@/lib/marketing/demo';
import { listPlansForSale, type PlanOffer } from '@/lib/billing/catalogue';
import { cn } from '@/lib/utils';
import { FEATURES } from '@/lib/billing/plans';
import { PrimaryCta, SecondaryCta } from '@/components/marketing/cta';
import { Faq, type FaqItem } from '@/components/marketing/faq';
import { FeatureMarquee } from '@/components/marketing/feature-marquee';
import { FlowDiagram } from '@/components/marketing/flow-diagram';
import { Marked, SectionIntro } from '@/components/marketing/section';
import { SupportChatLink } from '@/components/marketing/support-chat';
import { supportChatOn } from '@/components/marketing/support-chat-mount';
import {
  AlertMini,
  AssistantPreview,
  ChatMini,
  CounterMini,
  InvoiceMini,
  ShopperAppPreview,
  ReportMini,
  SocialPreview,
  StorefrontPreview,
  TeamMini,
} from '@/components/marketing/product-visuals';
import {
  CounterScene,
  HeroScene,
  PaymentScene,
} from '@/components/marketing/photo-scenes';

export const revalidate = 600;

export const metadata: Metadata = {
  title: {
    absolute: `${PLATFORM_NAME} — sell in your shop, online and on Instagram`,
  },
  description: `Sell at your counter, on your own website and on Instagram from the same stock. Online payments go straight to your bank, and ${PLATFORM_NAME} takes no commission on your sales.`,
  alternates: { canonical: '/' },
  openGraph: {
    title: `${PLATFORM_NAME} — sell in your shop, online and on Instagram`,
    description:
      'Stock, sales, delivery and payments for shops across Nigeria. No commission on your sales.',
    type: 'website',
  },
};

async function loadPlans(): Promise<PlanOffer[]> {
  try {
    return await listPlansForSale();
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [offer, plans] = await Promise.all([getPublicOffer(), loadPlans()]);
  const trial =
    offer.trialDays > 0 ? `${offer.trialDays}-day free trial` : null;
  const cheapest = plans.reduce<PlanOffer | null>(
    (low, p) => (!low || p.monthlyPrice < low.monthlyPrice ? p : low),
    null,
  );
  const chat = supportChatOn();
  const demoShop = getDemoShopUrl();
  // Which plans include the shopping assistant and image search — from the catalogue, so the page follows the console.
  const aiPlans = plans
    .filter((p) => p.features.includes(FEATURES.AI_SHOPPING))
    .map((p) => p.name);
  const aiOn =
    aiPlans.length === 0
      ? null
      : aiPlans.length === plans.length
        ? 'On every plan.'
        : `On ${aiPlans.length === 1 ? aiPlans[0] : `${aiPlans.slice(0, -1).join(', ')} and ${aiPlans[aiPlans.length - 1]}`}.`;
  const appPrice =
    offer.appSetupFee !== null && offer.appYearlyFee !== null
      ? `${formatMoney(offer.appSetupFee)} to set up, including the first year, then ${formatMoney(offer.appYearlyFee)} a year`
      : null;

  const facts = [
    {
      figure: '₦0',
      text: 'taken from your sales. Your plan is the only thing you pay us.',
    },
    trial && {
      figure: `${offer.trialDays} days`,
      text: `free${offer.trialPlanName ? ` on ${offer.trialPlanName}` : ''}, with no card needed to start.`,
    },
    {
      figure: '36 + Abuja',
      text: 'Set your own delivery price for every state and Abuja, down to the local area.',
    },
    offer.fromMonthly && {
      figure: formatMoney(offer.fromMonthly),
      text: `a month${cheapest ? ` for ${cheapest.name}` : ''}. Pay yearly and it costs less.`,
    },
  ].filter(Boolean) as { figure: string; text: string }[];

  const faq: FaqItem[] = [
    {
      q: 'Do I need a card to start?',
      a: trial
        ? `No. You get a ${trial}${offer.trialPlanName ? ` of ${offer.trialPlanName}` : ''} without a card. You only pay if you choose a plan.`
        : 'No card is needed to create your shop. You pay when you choose a plan.',
    },
    {
      q: 'Can I use my own web address, like yourshop.com.ng?',
      a: `Yes. Every shop starts at shop-yourname.${PLATFORM_DOMAIN}. If you already own a web address (also called a domain) — a .com, a .com.ng or any other — you can connect it for free on any plan, even during your trial. On a paid plan you can also buy ${offer.comNg ? 'a .com or .com.ng' : 'a .com'} through us, registered in your business’s name, with the price and what it renews at shown before you pay. It’s usually ready within 24 hours.${offer.freeDomainPlans.length ? ` Pay yearly on ${orList(offer.freeDomainPlans)} and your first year of a .com.ng is free.` : ''}`,
    },
    {
      q: 'Can my customers shop from an app?',
      a: appPrice
        ? `Yes. On a paid plan you can add your shop’s own Android and iPhone app, with your name and icon: ${appPrice}. We build it and get it ready for Google Play and the App Store. It’s listed under your business’s own Apple and Google accounts, so it belongs to you.`
        : 'Yes. On a paid plan you can add your shop’s own Android and iPhone app, with your name and icon. We build it and get it ready for Google Play and the App Store. It’s listed under your business’s own Apple and Google accounts, so it belongs to you. Ask us about the price.',
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
      q: 'I already keep my products in a spreadsheet.',
      a: 'Bring it straight in. Up to 500 products at a time, with sizes, colours and how many you have in each branch. You see exactly what will be added before anything is saved.',
    },
    {
      q: 'Who owns my data?',
      a: 'You do. Your products, customers and orders are yours, and you can download them as spreadsheets whenever you like.',
    },
  ];

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:64px_64px] opacity-60 [mask-image:radial-gradient(ellipse_70%_60%_at_70%_30%,black,transparent)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)] lg:gap-14 lg:pb-28 lg:pt-20">
          <div>
            {/* <p className="flex items-center gap-2 text-[14px] font-semibold text-primary">
              <span aria-hidden className="h-px w-5 bg-primary" />
              For shops and boutiques across Nigeria
            </p> */}
            <h1 className="mt-5 font-mk-display text-[2.7rem] font-bold leading-[1.02] tracking-[-0.04em] sm:text-[3.6rem]">
              <span className="block">Sell anywhere.</span>
              <span className="block">
                <Marked>One stock count.</Marked>
              </span>
            </h1>
            <p className="text-pretty mt-6 max-w-xl text-[18px] leading-relaxed text-muted-foreground">
              Sell at your counter, on your own website and on Instagram.
              Whenever something sells, {PLATFORM_NAME} takes it off your stock
              in the right branch, so you always know what you have. Online
              payments go straight to your bank.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <PrimaryCta href="/register">
                {trial ? `Start your ${trial}` : 'Create your shop'}
              </PrimaryCta>
              <SecondaryCta href="/pricing">See pricing</SecondaryCta>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-foreground/80">
              {[
                'No card needed',
                'No commission on your sales',
                'Your data stays yours',
              ].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check
                    className="size-4 text-primary"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  {t}
                </li>
              ))}
            </ul>
            {demoShop && (
              <p className="mt-5 text-[15px]">
                <a
                  href={demoShop}
                  target="_blank"
                  rel="noopener"
                  className="group inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Look around a live demo shop
                  <ArrowUpRight
                    className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </a>
              </p>
            )}
          </div>

          <HeroScene className="lg:-mr-6 lg:pl-8" />
        </div>
        {/* <div className="relative mx-auto max-w-6xl px-4 pb-14 sm:px-6">
          <p className="text-[13px] font-semibold text-muted-foreground">Made for shops that sell</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {[
              'Clothes and fabrics',
              'Shoes and bags',
              'Phones and gadgets',
              'Beauty and skincare',
              'Food and groceries',
              'Home and furniture',
              'Books and stationery',
              'Baby and kids',
            ].map((t) => (
              <li key={t} className="rounded-full border bg-card px-3.5 py-1.5 text-[14px] text-foreground/85">
                {t}
              </li>
            ))}
          </ul>
        </div> */}
      </section>

      {/* ── Everything it does, drifting past — a glance before the details ── */}
      <FeatureMarquee className="border-t bg-card py-8 sm:py-10" />

      {/* ── How it fits together ─────────────────────────────────────── */}
      <section aria-labelledby="one-shelf" className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionIntro
            id="one-shelf"
            label="How it fits together"
            title="Every sale lands in one place."
            body="Most shops sell in more than one way. Instead of a notebook for the counter, a spreadsheet for stock and DMs for Instagram, every sale is recorded in the same place — and your stock count updates by itself."
          />
          <div className="mt-14">
            <FlowDiagram />
          </div>
        </div>
      </section>

      {/* ── The facts ────────────────────────────────────────────────── */}
      <section aria-label="The facts" className="border-b">
        <dl
          className={cn(
            'mx-auto grid max-w-6xl grid-cols-2 sm:px-6',
            facts.length >= 4
              ? 'lg:grid-cols-4'
              : facts.length === 3
                ? 'sm:grid-cols-3'
                : '',
          )}
        >
          {facts.map((f, i) => (
            <div
              key={f.figure}
              className={cn(
                'px-4 py-8 sm:px-6',
                i % 2 === 1 && 'border-l',
                i >= 2 && 'border-t',
                facts.length >= 4 && i > 0 && 'lg:border-l lg:border-t-0',
                facts.length === 3 &&
                  'sm:border-t-0 sm:[&:not(:first-child)]:border-l',
                i === 0 && 'sm:pl-0',
              )}
            >
              <dt className="font-mk-display text-[1.8rem] font-bold leading-none tracking-[-0.03em] tabular-nums text-foreground sm:text-[2.4rem]">
                {f.figure}
              </dt>
              <dd className="mt-3 max-w-[16rem] text-[14px] leading-snug text-muted-foreground sm:text-[15px]">
                {f.text}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── What makes it different ─────────────────────────────────── */}
      <section aria-labelledby="different-title" className="bg-mk-leaf">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionIntro
            id="different-title"
            label="What makes it different"
            title="More than an online shop."
            body="The extras that help your customers find what they want — and keep coming back."
          />
          <ul
            className={cn(
              'mt-12 grid gap-4 sm:grid-cols-2',
              aiOn ? 'lg:grid-cols-4' : 'lg:grid-cols-2',
            )}
          >
            {[
              aiOn && {
                icon: MessageCircle,
                t: 'AI shopping assistant',
                d: 'Shoppers type what they want in their own words, and see the products in your shop that match.',
                href: '#assistant',
              },
              aiOn && {
                icon: ImageIcon,
                t: 'Search with an image',
                d: 'A shopper uploads a photo of something they like and sees what’s similar in your shop.',
                href: '#assistant',
              },
              {
                icon: Smartphone,
                t: 'Your shop’s own app',
                d: 'An Android and iPhone app with your name and icon, for customers to shop from.',
                href: '#app',
              },
              {
                icon: Globe,
                t: 'Your own web address',
                d: 'Like yourshop.com.ng. Already own one? Connect it free, on every plan.',
                href: '#online-shop',
              },
            ]
              .filter(
                (
                  x,
                ): x is {
                  icon: typeof Globe;
                  t: string;
                  d: string;
                  href: string;
                } => Boolean(x),
              )
              .map(({ icon: Icon, t, d, href }) => (
                <li key={t}>
                  <a
                    href={href}
                    className="group flex h-full flex-col rounded-3xl border border-[#cfe0d4] bg-card p-6 transition-shadow hover:shadow-[0_18px_40px_-20px_rgba(14,107,71,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="mt-5 font-mk-display text-[19px] font-semibold tracking-[-0.01em]">
                      {t}
                    </span>
                    <span className="mt-1.5 flex-1 text-[15px] leading-relaxed text-muted-foreground">
                      {d}
                    </span>
                    <span className="mt-5 inline-flex items-center gap-1 text-[14px] font-semibold text-primary">
                      See how
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </a>
                </li>
              ))}
          </ul>
        </div>
      </section>

      {/* ── The four big jobs ────────────────────────────────────────── */}
      <section
        id="features"
        aria-labelledby="features-title"
        className="scroll-mt-20"
      >
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-28">
          <SectionIntro
            id="features-title"
            label="What it does"
            title={
              <>
                Built around how shops here <Marked>actually sell.</Marked>
              </>
            }
          />
          <div className="mt-16 space-y-8 sm:mt-20">
            <Chapter
              n="01"
              kicker="Stock"
              title="Know what’s on every shelf, in every branch."
              body="Each of your branches keeps its own count. Every sale — at the counter or online — is taken off the branch it came from, so the number you see is the number on the shelf. We warn you when something is running low."
              points={[
                'One product in many sizes, colours or materials',
                'Move stock from one branch to another and see when it arrives',
                'Count what’s on your shelves and spot what’s missing',
                'Add all your products at once from a spreadsheet, like Excel',
              ]}
              stage="bg-mk-leaf"
              visual={<CounterScene />}
            />
            <Chapter
              id="online-shop"
              reverse
              n="02"
              kicker="Your online shop"
              title="Your own website, at your own address."
              body={`Your products go online at shop-yourname.${PLATFORM_DOMAIN} from day one — or at your own web address, like yourshop.com.ng. Shoppers see a delivery price for their area before they pay, worked out from the prices you set and the branch that has the item.`}
              points={[
                'Use a web address you already own, free on every plan',
                'Or get one through us, registered in your business’s name',
                'Your own delivery prices by state and area, plus pickup points',
                'Shoppers pay by card, bank transfer or on delivery',
                'Stays closed to customers, showing “Opening soon”, until you’re ready',
              ]}
              stage="bg-mk-sun-soft"
              visual={<StorefrontPreview />}
            />
            <Chapter
              n="03"
              kicker="Getting paid"
              title="Online payments go straight to your bank."
              body={`When a customer pays by card or transfer, Paystack pays you directly into your own bank account, less its standard fee. ${PLATFORM_NAME} never holds your money.`}
              points={[
                'We verify your business once, then you can take payments',
                'Every payment shows Paystack’s fee and what you received',
                'If a customer asks their bank to reverse a payment, you see it on the order, with the date to respond by',
              ]}
              stage="bg-mk-sun-soft"
              visual={<PaymentScene />}
            />
            <Chapter
              reverse
              n="04"
              kicker="Instagram and Facebook"
              title="Post your products without retyping them."
              body="Pick a product and we write a caption for you from its details — without making up prices or promises. Change anything you like, then post to your Facebook Page and Instagram at the same time."
              points={[
                'Connect your Facebook Page and Instagram in a few clicks',
                'Captions written from your product details, yours to edit',
                'See every post you’ve made, and retry any that didn’t go through',
              ]}
              stage="bg-mk-leaf"
              visual={<SocialPreview />}
            />
            {aiOn && (
              <Chapter
                id="assistant"
                n="05"
                kicker="AI shopping assistant"
                title="Shoppers ask. Your shop answers with products."
                body="Shoppers type what they want in their own words — “something in ankara for a wedding, under ₦20,000” — and the AI shopping assistant searches your shop and brings back the products that fit. Or they upload a photo of something they like, and see what’s similar in your shop."
                points={[
                  'Answers questions about a product’s sizes, colours and details',
                  'Suggests cheaper, pricier or similar items, and compares two side by side',
                  'Search with a photo: upload a picture, see similar products',
                  'Shows only your own products and prices — it never makes things up',
                ]}
                note={aiOn}
                stage="bg-mk-sun-soft"
                visual={<AssistantPreview />}
              />
            )}
          </div>
        </div>
      </section>

      {/* ── The shop's own app (an add-on) ──────────────────────────────── */}
      <section
        id="app"
        aria-labelledby="app-title"
        className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-24 sm:px-6 sm:pb-28"
      >
        <div className="relative grid grid-cols-1 items-center gap-10 overflow-hidden rounded-[2rem] bg-mk-deep p-6 text-white sm:p-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:p-14">
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 -right-24 size-[28rem] rounded-full bg-primary/40 blur-3xl"
          />
          <div className="relative">
            <p className="flex items-center gap-3">
              <span className="font-mk-display text-[15px] font-bold tabular-nums text-mk-sun">
                {aiOn ? '06' : '05'}
              </span>
              <span className="text-[14px] font-semibold text-white/80">
                Your shop’s own app
              </span>
              <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-[11.5px] font-medium text-white/70">
                Optional extra
              </span>
            </p>
            <h2
              id="app-title"
              className="text-balance mt-3 font-mk-display text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[2.4rem]"
            >
              Put your shop on your customers’ phones.
            </h2>
            <p className="text-pretty mt-4 text-[16px] leading-relaxed text-white/70">
              Your own Android and iPhone app, with your shop’s name and icon.
              Customers browse, pay and follow their orders in it — and it shows
              the same products, prices and stock as your website, so there’s
              nothing extra to keep up to date.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Order updates arrive as notifications on their phone',
                'Change products or prices and the app shows it straight away',
                'A “Get our app” banner and QR code on your website',
                'We build it and get it ready for Google Play and the App Store',
              ].map((p) => (
                <li key={p} className="flex gap-3 text-[15px]">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-mk-sun text-[#11211a]"
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-7 rounded-2xl border border-white/15 bg-white/[0.05] p-4 text-[14px] leading-relaxed">
              {appPrice ? (
                <p>
                  <span className="font-semibold text-white">
                    Available on any paid plan:
                  </span>{' '}
                  <span className="text-white/75">{appPrice}.</span>
                </p>
              ) : (
                <p>
                  <span className="font-semibold text-white">
                    Available on any paid plan, for an extra fee.
                  </span>{' '}
                  <span className="text-white/75">
                    {chat ? (
                      <>
                        <SupportChatLink className="font-medium text-mk-sun underline underline-offset-4">
                          Chat with us
                        </SupportChatLink>{' '}
                        about the price.
                      </>
                    ) : (
                      <>
                        Email{' '}
                        <a
                          href={`mailto:${PLATFORM_SUPPORT_EMAIL}`}
                          className="font-medium text-mk-sun underline underline-offset-4"
                        >
                          {PLATFORM_SUPPORT_EMAIL}
                        </a>{' '}
                        about the price.
                      </>
                    )}
                  </span>
                </p>
              )}
              <p className="mt-1 text-[13px] text-white/55">
                It’s listed in the app stores under your business’s own Apple
                and Google accounts, so the app belongs to you.
              </p>
            </div>
          </div>
          <div className="relative">
            <ShopperAppPreview />
          </div>
        </div>
      </section>

      {/* ── Everything else ──────────────────────────────────────────── */}
      <section aria-labelledby="rest-title" className="border-y bg-card">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionIntro
            id="rest-title"
            label="And the rest of the day-to-day"
            title="The jobs around the sale, handled too."
            body="Everything below works on the same stock, customers and orders — nothing to copy between apps."
          />
          <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                t: 'Counter sales',
                d: 'Sell in person from the same stock, and hand over a receipt.',
                v: <CounterMini />,
                align: 'end',
              },
              {
                t: 'Chat with your shoppers',
                d: 'Shoppers message you from your website, and you reply from the dashboard or your phone.',
                v: <ChatMini />,
              },
              {
                t: 'Quotes and invoices',
                d: 'Send a price quote, turn it into an invoice, and record what’s been paid.',
                v: <InvoiceMini />,
              },
              {
                t: 'Alerts on your phone',
                d: 'Know the moment an order comes in or stock runs low — on your phone or computer.',
                v: <AlertMini />,
              },
              {
                t: 'Your staff',
                d: 'Invite your staff and choose what each person can do — even which branch they work in.',
                v: <TeamMini />,
              },
              {
                t: 'Reports',
                d: 'Sales, profit and best-sellers in each branch — download them as spreadsheets too.',
                v: <ReportMini />,
              },
            ].map((c) => (
              <li
                key={c.t}
                className="flex flex-col overflow-hidden rounded-3xl border bg-background"
              >
                <div className="p-6 pb-0">
                  <h3 className="font-mk-display text-[19px] font-semibold tracking-[-0.01em]">
                    {c.t}
                  </h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
                    {c.d}
                  </p>
                </div>
                <div
                  className={cn(
                    'mt-6 flex flex-1 px-6',
                    c.align === 'end' ? 'items-end' : 'items-center pb-6',
                  )}
                >
                  {c.v}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-12 rounded-3xl border bg-background p-6 sm:p-8">
            <h3 className="text-[15px] font-semibold">Also included</h3>
            <ul className="mt-4 flex flex-wrap gap-2">
              {[
                'Ordering from your suppliers',
                'Returns and refunds',
                'Discount codes',
                'Bundles, like gift sets',
                'Discounts that start and end by themselves',
                'Wholesale prices for businesses that buy in bulk',
                'Your shop’s own colours and layout',
                'Add products from a spreadsheet',
              ].map((t) => (
                <li
                  key={t}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3.5 py-1.5 text-[14px]"
                >
                  <Check
                    className="size-3.5 text-primary"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[14px] text-muted-foreground">
              Some of these depend on your plan.{' '}
              <Link
                href="/pricing"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                See what each plan includes
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section
        id="how-it-works"
        aria-labelledby="how-title"
        className="scroll-mt-20"
      >
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-28">
          <SectionIntro
            id="how-title"
            label="How it works"
            title="From sign-up to your first order."
            body="A short checklist in your dashboard shows what’s left, and your shop stays closed to customers until you open it."
          />
          <ol className="relative mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            <span
              aria-hidden
              className="absolute left-6 right-[25%] top-6 hidden h-px bg-[repeating-linear-gradient(to_right,var(--input)_0_6px,transparent_6px_12px)] lg:block"
            />
            {[
              {
                t: 'Create your shop',
                d: 'Choose your shop’s web address and tell us where your shop is. It takes a couple of minutes.',
              },
              {
                t: 'Add your products',
                d: 'One at a time with photos and sizes — or all at once from a spreadsheet, with the stock in each store.',
              },
              {
                t: 'Set up delivery and payments',
                d: 'Say where you deliver and what it costs, and how you’d like to be paid. Pay on delivery works from day one.',
              },
              {
                t: 'Open your shop',
                d: 'When everything’s ready, open it. Share the link, post to Instagram, and take your first order.',
              },
            ].map((step, i) => (
              <li key={step.t} className="relative">
                <span
                  className={cn(
                    'relative flex size-12 items-center justify-center rounded-full border-2 font-mk-display text-lg font-bold tabular-nums',
                    i === 3
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-primary bg-background text-primary',
                  )}
                >
                  {i + 1}
                </span>
                <h3 className="mt-5 font-mk-display text-[19px] font-semibold">
                  {step.t}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  {step.d}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── What it costs ────────────────────────────────────────────── */}
      <section
        aria-labelledby="pricing-title"
        className="bg-mk-deep text-white"
      >
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.25fr] lg:items-center">
          <div>
            <p className="flex items-center gap-2 text-[13px] font-semibold text-mk-sun">
              <span aria-hidden className="h-px w-5 bg-mk-sun" />
              Pricing
            </p>
            <h2
              id="pricing-title"
              className="text-balance mt-3 font-mk-display text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[2.6rem]"
            >
              Pay for your plan. Keep your sales.
            </h2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-white/70">
              No commission on any plan. Pay monthly, every six months or yearly
              — the longer you pay for, the less it costs.
            </p>
            <div className="mt-8">
              <SecondaryCta href="/pricing" tone="light">
                Compare plans
              </SecondaryCta>
            </div>
          </div>
          {plans.length > 0 && (
            <ul className="divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
              {plans.map((p) => (
                <li key={p.id}>
                  <Link
                    href="/pricing"
                    className="group flex items-center gap-5 px-6 py-5 transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.06] focus-visible:outline-none"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2.5 font-mk-display text-[20px] font-semibold">
                        {p.name}
                        {p.highlighted && (
                          <span className="rounded-full bg-mk-sun px-2 py-0.5 font-sans text-[11px] font-semibold text-[#11211a]">
                            Recommended
                          </span>
                        )}
                      </p>
                      {p.tagline && (
                        <p className="mt-0.5 text-[14px] text-white/60">
                          {p.tagline}
                        </p>
                      )}
                    </div>
                    <p className="text-right">
                      <span className="block font-mk-display text-[22px] font-bold tabular-nums">
                        {formatMoney(p.monthlyPrice)}
                      </span>
                      <span className="text-[13px] text-white/55">a month</span>
                    </p>
                    <ArrowRight
                      className="size-4 shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Questions ────────────────────────────────────────────────── */}
      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 sm:py-28 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <SectionIntro
              id="faq-title"
              label="Questions"
              title="What shop owners ask us."
            />
            <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
              Something else?{' '}
              {chat ? (
                <>
                  <SupportChatLink className="font-medium text-primary underline underline-offset-4">
                    Chat with us
                  </SupportChatLink>{' '}
                  or email{' '}
                </>
              ) : (
                'Email '
              )}
              <a
                href={`mailto:${PLATFORM_SUPPORT_EMAIL}`}
                className="font-medium text-primary underline underline-offset-4"
              >
                {PLATFORM_SUPPORT_EMAIL}
              </a>
              .
            </p>
          </div>
          <Faq items={faq} />
        </div>
      </section>

      {/* ── Last word ────────────────────────────────────────────────── */}
      <section
        aria-labelledby="start-title"
        className="mx-auto max-w-6xl px-4 pb-24 sm:px-6"
      >
        <div className="relative overflow-hidden rounded-[2rem] bg-primary px-6 py-16 text-center text-white sm:px-12 sm:py-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:radial-gradient(circle,white_1.2px,transparent_1.6px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,transparent_30%,black)]"
          />
          <div
            aria-hidden
            className="absolute -right-20 -top-20 size-56 rounded-full border-[28px] border-mk-sun/90"
          />
          <div
            aria-hidden
            className="absolute -bottom-24 -left-16 size-48 rounded-full bg-white/[0.06]"
          />
          <div className="relative">
            <h2
              id="start-title"
              className="text-balance mx-auto max-w-2xl font-mk-display text-[2.1rem] font-bold leading-[1.05] tracking-[-0.03em] sm:text-5xl"
            >
              {trial
                ? `Try it with your own products for ${offer.trialDays} days.`
                : 'Set your shop up this week.'}
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-white/80">
              {trial
                ? `No card needed. Everything on ${offer.trialPlanName ?? 'the trial'} is included while you decide.`
                : 'Create your shop in a couple of minutes and follow the checklist.'}
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <PrimaryCta href="/register" tone="sun">
                {trial ? 'Start your free trial' : 'Create your shop'}
              </PrimaryCta>
              <SecondaryCta href="/pricing" tone="light">
                See pricing
              </SecondaryCta>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function Chapter({
  id,
  n,
  kicker,
  title,
  body,
  points,
  visual,
  stage,
  note,
  reverse = false,
}: {
  /** An anchor, for links from the "What makes it different" strip. */
  id?: string;
  n: string;
  kicker: string;
  title: string;
  body: string;
  points: string[];
  visual: React.ReactNode;
  stage: string;
  /** A short line under the points, e.g. which plans include it. */
  note?: string;
  reverse?: boolean;
}) {
  return (
    <article
      id={id}
      className="grid scroll-mt-24 grid-cols-1 items-center gap-8 rounded-[2rem] border bg-card p-5 sm:gap-10 sm:p-10 lg:grid-cols-2 lg:gap-14 lg:p-12"
    >
      <div className={reverse ? 'lg:order-2' : undefined}>
        <p className="flex items-baseline gap-3">
          <span className="font-mk-display text-[15px] font-bold tabular-nums text-mk-clay">
            {n}
          </span>
          <span className="text-[14px] font-semibold text-primary">
            {kicker}
          </span>
        </p>
        <h3 className="text-balance mt-3 font-mk-display text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[2.1rem]">
          {title}
        </h3>
        <p className="text-pretty mt-4 text-[16px] leading-relaxed text-muted-foreground">
          {body}
        </p>
        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex gap-3 text-[15px] text-foreground">
              <span
                aria-hidden
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-mk-leaf text-primary"
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
              {p}
            </li>
          ))}
        </ul>
        {note && (
          <p className="mt-6 text-[14px] font-medium text-primary">{note}</p>
        )}
      </div>
      <div
        className={cn(
          'min-w-0 rounded-3xl p-3 sm:p-8',
          stage,
          reverse && 'lg:order-1',
        )}
      >
        {visual}
      </div>
    </article>
  );
}
