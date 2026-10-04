/*
 * /account/deleted — where a shopper lands after deleting their account
 * (ROADMAP 13.8). They're signed out by then; this only confirms what happened.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { FINANCIAL_RETENTION_YEARS } from '@/lib/data-rights/policy';

export const metadata: Metadata = { title: 'Account deleted', robots: { index: false } };

export default function AccountDeletedPage() {
  return (
    <div className="sf-container py-16">
      <div className="mx-auto max-w-[27rem] rounded-3xl border border-border bg-card p-8 text-center">
        <h1 className="font-display text-xl font-semibold">Your account is deleted</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          You’ve been signed out, and your details, addresses, wishlist, reviews and questions are gone. Your past orders
          are kept for {FINANCIAL_RETENTION_YEARS} years, as the law requires, then your details are removed from them too.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center rounded-[var(--sf-radius-button,999px)] bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          Back to the store
        </Link>
      </div>
    </div>
  );
}
