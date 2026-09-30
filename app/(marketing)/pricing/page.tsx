/*
 * Public pricing (ROADMAP 12.3), read from the plan catalogue (12.1/11.7) —
 * the same source as /upgrade — so the prices here are the prices charged.
 * Only features that exist are listed (FEATURE_INFO.built).
 */
import type { Metadata } from 'next';
import { PLATFORM_CONTACT_EMAIL, PLATFORM_NAME } from '@/lib/brand';
import { listPlansForSale, type PlanOffer } from '@/lib/billing/catalogue';
import { getPublicOffer } from '@/lib/marketing/offer';
import { PrimaryCta } from '@/components/marketing/cta';
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
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-muted/60 to-transparent" />
        <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6 sm:pt-20">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">Pay for your plan. Keep your sales.</h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Pay for the plan that fits your shop — monthly, every six months or yearly. Online payments go straight to your bank
              through Paystack, and we take nothing from them.
            </p>
            {trial && (
              <p className="mt-4 text-sm text-foreground">
                Every shop starts with a <span className="font-medium">{trial}</span>. No card needed.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        {plans && plans.length > 0 ? (
          <PricingTable plans={plans} trialPlanName={offer.trialDays > 0 ? offer.trialPlanName : null} />
        ) : (
          <p className="mx-auto max-w-md rounded-xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
            Our plans couldn’t be shown just now. Please refresh in a moment, or{' '}
            <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="font-medium text-foreground underline underline-offset-4">
              write to us
            </a>
            .
          </p>
        )}
      </section>

      <section className="border-t">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.6fr]">
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.025em]">About paying.</h2>
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
                q: 'Is a web address included?',
                a: 'Every shop gets its own address on our domain. On a paid plan you can buy your own .com — the price, and what it renews at, are shown before you pay — or connect a domain you already own for free.',
              },
            ]}
          />
        </div>
      </section>

      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.025em]">Try it with your own products.</h2>
          <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
            {trial ? `Start with a ${trial}. No card needed.` : 'Create your shop in a couple of minutes.'}
          </p>
          <div className="mt-8 flex justify-center">
            <PrimaryCta href="/register">{trial ? 'Start your free trial' : 'Create your shop'}</PrimaryCta>
          </div>
        </div>
      </section>
    </>
  );
}
