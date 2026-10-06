/*
 * /account/menu — where the phone's Account tab leads (ROADMAP 16.5).
 *
 * On a phone the header is only a search box and there is no footer, so
 * this page is how a shopper reaches everything else: their account (or
 * signing in), tracking an order, the shop's own pages and contact details,
 * and the dark-mode switch. It works signed in or out.
 *
 * It is also what keeps a store's own app approvable: Apple and Google both
 * want the privacy policy, a way to contact the shop and account deletion
 * reachable inside the app — the privacy page and "Your data" are here.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, LayoutGrid, Mail, MapPin, Package, PackageSearch, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { getShopper } from '@/lib/storefront/account/session';
import { getStorePages, getStorefrontLook } from '@/lib/storefront/catalog';
import { footerPageLinks } from '@/lib/storefront/pages/rules';
import { ThemeToggle } from '@/components/storefront/layout/theme-toggle';
import { SignOutButton } from '../_components/account-nav';

export const metadata: Metadata = { title: 'Account', robots: { index: false, follow: false } };

type Props = { params: Promise<{ organizationSlug: string }> };

export default async function AccountMenuPage({ params }: Props) {
  const { organizationSlug } = await params;
  const [shopper, pages, look] = await Promise.all([
    getShopper(),
    getStorePages({ organizationSlug }),
    getStorefrontLook({ organizationSlug }),
  ]);
  const { help, about } = footerPageLinks(pages);
  const shopPages = [...help, ...about];
  const { email, phone } = look.contact;

  return (
    <div className="sf-container py-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl space-y-6">
        {shopper ? (
          <>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Hi, {shopper.firstName}</h1>
            <Group title="Your account">
              <Row href="/account" icon={LayoutGrid}>Overview</Row>
              <Row href="/account/orders" icon={Package}>Orders</Row>
              <Row href="/account/addresses" icon={MapPin}>Addresses</Row>
              <Row href="/account/profile" icon={UserRound}>Profile</Row>
              <Row href="/account/privacy" icon={ShieldCheck}>Your data</Row>
            </Group>
          </>
        ) : (
          <>
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight">Account</h1>
              <p className="mt-1 text-sm text-muted-foreground">Sign in to see your orders, saved addresses and details.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link
                href="/account/sign-in?next=%2Faccount"
                className="inline-flex h-11 items-center justify-center rounded-[var(--sf-radius-button,999px)] bg-brand px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
              >
                Sign in
              </Link>
              <Link
                href="/account/register?next=%2Faccount"
                className="inline-flex h-11 items-center justify-center rounded-[var(--sf-radius-button,999px)] border border-border bg-card px-4 text-sm font-semibold transition-colors hover:border-brand hover:text-brand"
              >
                Create an account
              </Link>
            </div>
            <Group>
              <Row href="/track-order" icon={PackageSearch}>Track an order</Row>
            </Group>
          </>
        )}

        {(shopPages.length > 0 || email || phone) && (
          <Group title="Help and information">
            {shopPages.map((page) => (
              <Row key={page.href} href={page.href}>
                {page.label}
              </Row>
            ))}
            {email && (
              <Row href={`mailto:${email}`} icon={Mail} external>
                {email}
              </Row>
            )}
            {phone && (
              <Row href={`tel:${phone.replace(/[^\d+]/g, '')}`} icon={Phone} external>
                {phone}
              </Row>
            )}
          </Group>
        )}

        <Group title="Settings">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span>Dark mode</span>
            <ThemeToggle className="size-9 border border-border opacity-100 hover:bg-accent" />
          </div>
        </Group>

        {shopper && <SignOutButton />}
      </div>
    </div>
  );
}

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section>
      {title && <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>}
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">{children}</div>
    </section>
  );
}

function Row({
  href,
  icon: Icon,
  external = false,
  children,
}: {
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  external?: boolean;
  children: React.ReactNode;
}) {
  const inner = (
    <>
      {Icon && <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {!external && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const className = 'flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent';
  return external ? (
    <a href={href} className={className}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}
