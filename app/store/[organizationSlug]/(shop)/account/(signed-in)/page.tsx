/*
 * /account — the overview.
 *
 * It says who is signed in, how they sign in, and what to do next. There are
 * deliberately no tiles for orders, addresses or a saved list yet: each of
 * those arrives with the part that makes it real, and a card that leads
 * nowhere teaches a shopper that this page is decoration.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Heart, KeyRound, Mail, MapPin, Package, Phone, UserRound } from 'lucide-react';
import { getShopper } from '@/lib/storefront/account/session';
import { getSignInMethods } from '@/lib/storefront/account/profile';
import { listAddresses } from '@/lib/storefront/account/addresses';
import { listWishlist } from '@/lib/storefront/account/wishlist';
import { listOrdersForCustomer } from '@/lib/storefront/orders/read';
import { formatDate, formatMoney } from '@/lib/storefront/format';
import { OrderStatusPill } from '@/components/storefront/orders/order-status';
import { AccountCard, CardAction, DetailRow } from '../_components/account-card';

export const metadata: Metadata = { title: 'Your account' };

export default async function AccountOverviewPage() {
  // The layout has already required a session; this cannot be null here.
  const shopper = (await getShopper())!;
  const scope = { organizationId: shopper.organizationId, customerId: shopper.id };
  const [methods, addresses, saved, orders] = await Promise.all([
    getSignInMethods(shopper.organizationId, shopper.id),
    listAddresses(scope),
    listWishlist(scope),
    listOrdersForCustomer({ organizationId: shopper.organizationId }, shopper.id, 1),
  ]);
  const latestOrder = orders[0] ?? null;
  const defaultAddress = addresses[0] ?? null;

  return (
    <div className="space-y-5">
      <AccountCard
        title="Your details"
        action={<CardAction href="/account/profile">Edit</CardAction>}
      >
        <dl className="space-y-3.5">
          <DetailRow icon={UserRound} label="Name" value={shopper.name} />
          <DetailRow icon={Mail} label="Email" value={shopper.email} />
          <DetailRow icon={Phone} label="Phone" value={shopper.phone ?? 'Not added yet'} />
        </dl>
      </AccountCard>

      <AccountCard
        title="Orders"
        action={<CardAction href="/account/orders">All orders</CardAction>}
      >
        {latestOrder ? (
          <Link
            href={`/account/orders/${latestOrder.reference}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-2"
          >
            <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium tabular-nums">{latestOrder.reference}</span>
            <OrderStatusPill status={latestOrder.status} />
            <span className="text-sm text-muted-foreground">
              {formatDate(latestOrder.placedAt, 'en-NG')} ·{' '}
              {formatMoney(latestOrder.totals.total, latestOrder.currency)}
            </span>
          </Link>
        ) : (
          <p className="flex items-center gap-3 text-sm text-muted-foreground">
            <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Nothing ordered yet. Anything you buy shows up here with its progress.
          </p>
        )}
      </AccountCard>

      <AccountCard
        title="Saved items"
        action={<CardAction href="/wishlist">View</CardAction>}
      >
        <p className="flex items-center gap-3 text-sm text-muted-foreground">
          <Heart className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {saved.length > 0
            ? `${saved.length} ${saved.length === 1 ? 'item' : 'items'} waiting for you, at today's prices.`
            : 'Nothing saved yet — tap the heart on anything you like.'}
        </p>
      </AccountCard>

      <AccountCard title="How you sign in">
        <div className="flex flex-wrap gap-2">
          {methods.google && (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3.5 py-1.5 text-sm">
              <GoogleMark /> Google
            </span>
          )}
          {methods.hasPassword && (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3.5 py-1.5 text-sm">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden /> Email and password
            </span>
          )}
        </div>

        <p className="mt-3.5 text-sm text-muted-foreground">
          {methods.google && !methods.hasPassword
            ? 'You can add a password on your profile, so you can still sign in if Google is ever unavailable.'
            : 'Change your password any time from your profile.'}
        </p>
      </AccountCard>

      <AccountCard
        title="Delivery address"
        action={<CardAction href="/account/addresses">{addresses.length > 1 ? `All ${addresses.length}` : 'Manage'}</CardAction>}
      >
        {defaultAddress ? (
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">{defaultAddress.fullName}</span>
              <span className="block">{defaultAddress.line1}</span>
              <span className="block">
                {[defaultAddress.city, defaultAddress.state].filter(Boolean).join(', ')}
              </span>
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Save an address and checkout will fill it in for you.
            </p>
            <Link
              href="/account/addresses/new"
              className="mt-4 inline-flex h-11 items-center rounded-full bg-brand px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
            >
              Add an address
            </Link>
          </>
        )}
      </AccountCard>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14Z" />
    </svg>
  );
}
