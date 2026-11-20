/*
 * How a shop takes payment, as logos: the footer's bottom bar and the
 * "Pay online" choice at checkout.
 *
 * ONLY WHAT CHECKOUT OFFERS THIS SHOP. Callers pass the shop's own checkout
 * methods (lib/storefront/checkout/store-config.ts), so a shop with pay on
 * delivery turned off shows no pay-on-delivery badge, and a shop that can't
 * take online payments shows neither Paystack nor any card.
 *
 * The card logos ride on Paystack: shoppers pay on Paystack's own page, and
 * Paystack in Nigeria takes Visa, Mastercard and Verve. They are never shown
 * without online payment, because without it no card is taken at all.
 *
 * The logos (public/payments/) are the brands' own artwork, so each sits on
 * its own white chip in light and dark mode alike rather than being
 * recoloured. Pay on delivery and bank transfer are not brands: they're the
 * shop's usual icons with their words beside them. Every logo has its name
 * as alt text — a logo is never the only way to say what it is.
 *
 * Server-safe: no hooks, no client JS.
 */
import { Banknote, Landmark, Wallet, type LucideIcon } from 'lucide-react';
import type { PaymentMethodOption } from '@/lib/storefront/checkout/types';
import { cn } from '@/lib/utils';

/* Each file has its own margins, so each is sized to look the same weight in
 * its chip: Verve's artwork is a whole card and fills it; Mastercard's mark
 * sits small in a wide circle, so it's drawn larger and the chip crops the
 * empty edge. */
export const CARD_LOGOS = [
  { name: 'Visa', src: '/payments/visa.svg', fit: 'h-4 w-7 object-contain' },
  { name: 'Mastercard', src: '/payments/mastercard.svg', fit: 'size-10 max-w-none' },
  { name: 'Verve', src: '/payments/verve.svg', fit: 'size-full object-cover' },
] as const;

const OFFLINE: Record<string, LucideIcon> = {
  pod: Banknote,
  transfer: Landmark,
  account: Wallet,
};

const CHIP = 'inline-flex h-6 shrink-0 items-center justify-center rounded-[4px] border border-border bg-white';

function Logo({ src, name, className }: { src: string; name: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={name} width={36} height={22} loading="lazy" decoding="async" className={className} />;
}

/** Paystack, then the cards it takes. */
export function OnlinePaymentLogos({ className }: { className?: string }) {
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className={cn(CHIP, 'px-2')}>
        <Logo src="/payments/paystack.svg" name="Paystack" className="h-3 w-auto" />
      </span>
      {CARD_LOGOS.map((card) => (
        <span key={card.name} className={cn(CHIP, 'w-9 overflow-hidden')}>
          <Logo src={card.src} name={card.name} className={card.fit} />
        </span>
      ))}
    </span>
  );
}

/** Every way this shop's checkout takes payment, as badges. Nothing when it offers none. */
export function PaymentBadges({ methods, className }: { methods: PaymentMethodOption[]; className?: string }) {
  const offered = methods.filter((m) => m.enabled);
  if (!offered.length) return null;

  return (
    <ul aria-label="Ways to pay" className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      {offered.map((method) => {
        if (method.provider === 'paystack') {
          return (
            <li key={method.id} className="flex items-center gap-2">
              <span className="sr-only">Pay online securely with Paystack:</span>
              <OnlinePaymentLogos />
            </li>
          );
        }
        const Icon = OFFLINE[method.id];
        return (
          <li key={method.id} className="flex items-center gap-1.5 whitespace-nowrap">
            {Icon && <Icon aria-hidden className="size-3.5" />}
            {method.label}
          </li>
        );
      })}
    </ul>
  );
}
