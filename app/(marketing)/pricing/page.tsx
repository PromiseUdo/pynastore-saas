/*
 * Public pricing (ROADMAP 12.3), read from the plan catalogue (12.1/11.7) —
 * the same source as /upgrade — so the prices here are the prices charged.
 * Only features that exist are listed (FEATURE_INFO.built).
 */
import type { Metadata } from 'next';
import { PLATFORM_NAME, PLATFORM_SUPPORT_EMAIL } from '@/lib/brand';
import { formatMoney } from '@/lib/format';
import { SupportChatLink } from '@/components/marketing/support-chat';
import { supportChatOn } from '@/components/marketing/support-chat-mount';
import { listPlansForSale, type PlanOffer } from '@/lib/billing/catalogue';
import { getPublicOffer, orList } from '@/lib/marketing/offer';
import { PrimaryCta } from '@/components/marketing/cta';
import { Marked, SectionIntro } from '@/components/marketing/section';
import { Faq } from '@/components/marketing/faq';
import { PricingTable } from './PricingTable';

export const revalidate = 600;

export const metadata: Metadata = {
  title: `Pricing — ${PLATFORM_NAME}`,
  description: `${PLATFORM_NAME} plans, monthly, every six months or yearly. No commission on your sales, on any plan.`,
  alternates: { canonical: '/pricing' },
};

async function loadPlans(): Promise<PlanOffer[] | null> {
  try {
    return await listPlansForSale();
  } catch {
    return null;
  }
}

export default async function PricingPage() {
  const [plans, offer] = await Promise.all([loadPlans(), getPublicOffer()]);
  const trial = offer.trialDays > 0 ? `${offer.trialDays}-day free trial${offer.trialPlanName ? ` of ${offer.trialPlanName}` : ''}` : null;

  return (
    <>
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:64px_64px] opacity-60 [mask-image:radial-gradient(ellipse_60%_70%_at_50%_0%,black,transparent)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 sm:pt-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="flex items-center justify-center gap-2 text-[14px] font-semibold text-primary">
              <span aria-hidden className="h-px w-5 bg-primary" />
              Pricing
            </p>
            <h1 className="text-balance mt-4 font-mk-display text-[2.6rem] font-bold leading-[1.02] tracking-[-0.04em] sm:text-[3.6rem]">
              Pay for your plan. <Marked>Keep your sales.</Marked>
            </h1>
            <p className="text-pretty mt-5 text-[18px] leading-relaxed text-muted-foreground">
              Pay for the plan that fits your shop — monthly, every six months or yearly. Online payments go straight to your bank
              through Paystack, and we take nothing from them.
            </p>
            {trial && (
              <p className="mt-6 inline-block rounded-full border bg-card px-4 py-2 text-[14px] text-foreground">
                <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-mk-sun align-middle" />
                Every shop starts with a <span className="font-semibold">{trial}</span>. No card needed.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        {plans && plans.length > 0 ? (
          <>
            <PricingTable plans={plans} trialPlanName={offer.trialDays > 0 ? offer.trialPlanName : null} />
            {supportChatOn() && (
              <p className="mt-10 text-center text-[15px] text-muted-foreground">
                Not sure which plan fits?{' '}
                <SupportChatLink className="font-medium text-foreground underline underline-offset-4">Chat with us</SupportChatLink>
                {' '}— a person on our team will help.
              </p>
            )}
          </>
        ) : (
          <p className="mx-auto max-w-md rounded-3xl border bg-card px-6 py-10 text-center text-[15px] text-muted-foreground">
            Our plans couldn’t be shown just now. Please refresh in a moment, or{' '}
            <a href={`mailto:${PLATFORM_SUPPORT_EMAIL}`} className="font-medium text-foreground underline underline-offset-4">
              write to us
            </a>
            .
          </p>
        )}
      </section>

      <section aria-labelledby="paying-title" className="border-t bg-card">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.6fr]">
          <SectionIntro id="paying-title" label="Questions" title="About paying." />
          <Faq
            items={[
              {
                q: 'What do I actually pay?',
                a: `Your plan, and nothing else to ${PLATFORM_NAME}. When a customer pays online, Paystack takes its standard fee and pays the rest straight into your bank account. Pay on delivery and bank transfers to your own account cost nothing extra.`,
              },
              {
                q: 'How do I pay for my plan?',
                a: 'By card, through Paystack. Your plan renews automatically at the end of each period, at the price you signed up at.',
              },
              {
                q: 'Can I change plans?',
                a: 'Yes, from your dashboard, at any time. A new plan starts straight away.',
              },
              {
                q: 'Can I cancel?',
                a: 'Yes. Cancelling stops the next renewal; you keep everything until the end of the period you’ve paid for.',
              },
              {
                q: 'What if I don’t renew?',
                a:
                  offer.graceDays && offer.graceDays > 0
                    ? `Your shop keeps taking orders for ${offer.graceDays} days, then pauses until you choose a plan. Nothing is deleted.`
                    : 'Your shop pauses until you choose a plan. Nothing is deleted.',
              },
              {
                q: 'What does my shop’s own app cost?',
                a:
                  offer.appSetupFee !== null && offer.appYearlyFee !== null
                    ? `It’s an add-on for any paid plan: ${formatMoney(offer.appSetupFee)} to set up, including the first year, then ${formatMoney(offer.appYearlyFee)} a year. You get an Android and an iPhone app with your shop’s name and icon, published under your own developer accounts.`
                    : 'It’s an add-on for any paid plan: an Android and an iPhone app with your shop’s name and icon, published under your own developer accounts. Ask us about the price.',
              },
              {
                q: 'Can I use my own domain?',
                a: `Yes. Every shop gets its own address on our domain, and you can connect a domain you already own — a .com, a .com.ng or any other — for free on any plan, even during your trial. On a paid plan you can also buy ${offer.comNg ? 'a .com or .com.ng' : 'a .com'} through us; the price, and what it renews at, are shown before you pay.${offer.freeDomainPlans.length ? ` Pay yearly on ${orList(offer.freeDomainPlans)} and your first year of a .com.ng is free; renewing it after that is at the normal price.` : ''}`,
              },
            ]}
          />
        </div>
      </section>

      <section aria-labelledby="start-title" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="relative overflow-hidden rounded-[2rem] bg-primary px-6 py-16 text-center text-white sm:px-12">
          <div aria-hidden className="absolute -right-20 -top-20 size-56 rounded-full border-[28px] border-mk-sun/90" />
          <div className="relative">
            <h2 id="start-title" className="text-balance font-mk-display text-[2.1rem] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[2.8rem]">
              Try it with your own products.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[17px] text-white/80">
              {trial ? `Start with a ${trial}. No card needed.` : 'Create your shop in a couple of minutes.'}
            </p>
            <div className="mt-8 flex justify-center">
              <PrimaryCta href="/register" tone="sun">
                {trial ? 'Start your free trial' : 'Create your shop'}
              </PrimaryCta>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
