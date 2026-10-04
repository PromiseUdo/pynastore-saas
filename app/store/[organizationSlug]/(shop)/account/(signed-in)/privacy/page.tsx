/*
 * /account/privacy — a shopper's rights over their own data (ROADMAP 13.8):
 * download a copy, or delete the account. What each does is said in full
 * before the button, and restates lib/data-rights (policy.ts, shopper.ts) —
 * change one, change the other.
 */
import type { Metadata } from 'next';
import { getShopper } from '@/lib/storefront/account/session';
import { getSignInMethods } from '@/lib/storefront/account/profile';
import { FINANCIAL_RETENTION_YEARS } from '@/lib/data-rights/policy';
import { AccountCard } from '../../_components/account-card';
import { AccountHeading } from '../../_components/account-heading';
import { DeleteAccountForm } from '../../_components/delete-account-form';

export const metadata: Metadata = { title: 'Your data' };

export default async function PrivacyPage() {
  const shopper = (await getShopper())!;
  const methods = await getSignInMethods(shopper.organizationId, shopper.id);

  return (
    <div className="space-y-5">
      <AccountHeading>Your data</AccountHeading>

      <AccountCard
        title="Download your data"
        description="A copy of everything this store holds about your account: your details, saved addresses, wishlist, orders, reviews and questions."
      >
        <a
          href="/account/export"
          download
          className="inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-button,999px)] border border-border px-6 text-base font-semibold transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Download my data
        </a>
        <p className="mt-3 text-sm text-muted-foreground">It downloads as a file you can open in any text editor.</p>
      </AccountCard>

      <AccountCard title="Delete your account" description="This can’t be undone.">
        <div className="space-y-3 text-sm leading-relaxed">
          <p>Deleting your account:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>signs you out everywhere and removes your password and Google sign-in;</li>
            <li>deletes your saved addresses, wishlist, reviews and questions;</li>
            <li>removes your email and phone number from the store’s customer list, and stops any marketing.</li>
          </ul>
          <p>
            Your past orders are kept, with the name and delivery address on them, because the law requires shops to keep
            records of sales for {FINANCIAL_RETENTION_YEARS} years. After that, your details are removed from them too.
          </p>
          <p className="text-muted-foreground">You can create a new account with the same email address later if you like.</p>
        </div>
        <div className="mt-5">
          <DeleteAccountForm hasPassword={methods.hasPassword} email={shopper.email} />
        </div>
      </AccountCard>
    </div>
  );
}
