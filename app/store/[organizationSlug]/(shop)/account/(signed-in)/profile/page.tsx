/*
 * /account/profile — the three things a shopper can change about themselves.
 *
 * Three separate forms, not one big one: saving a phone number and changing
 * a password are different acts with different consequences, and a single
 * Save button over both would make the small change feel as heavy as the
 * large one — and force the password fields to be filled in to do either.
 *
 * What the page offers depends on how the account signs in. A Google-only
 * account is offered a password to ADD (so it isn't locked out the day
 * Google is unreachable) and told plainly why its email isn't editable here.
 */
import type { Metadata } from 'next';
import { getShopper } from '@/lib/storefront/account/session';
import { getSignInMethods } from '@/lib/storefront/account/profile';
import { getPendingEmailChange } from '@/lib/storefront/account/email-change';
import { AccountCard } from '../../_components/account-card';
import { AccountHeading } from '../../_components/account-heading';
import { ProfileDetailsForm } from '../../_components/profile-details-form';
import { EmailForm } from '../../_components/email-form';
import { PasswordForm } from '../../_components/password-form';

export const metadata: Metadata = { title: 'Your profile' };

export default async function ProfilePage() {
  const shopper = (await getShopper())!;
  const [methods, pending] = await Promise.all([
    getSignInMethods(shopper.organizationId, shopper.id),
    getPendingEmailChange(shopper.organizationId, shopper.id),
  ]);

  return (
    <div className="space-y-5">
      <AccountHeading>Your profile</AccountHeading>

      <AccountCard title="Your details" description="Used on your orders and deliveries.">
        <ProfileDetailsForm name={shopper.name} phone={shopper.phone ?? ''} />
      </AccountCard>

      <AccountCard
        title="Email"
        description={
          methods.hasPassword
            ? 'The address you sign in with, and where order updates go. Changing it needs confirming from the new inbox.'
            : 'You sign in with Google, so this address comes from your Google account.'
        }
      >
        <EmailForm
          email={shopper.email}
          verified={shopper.emailVerified}
          editable={methods.hasPassword}
          pendingEmail={pending?.newEmail ?? null}
        />
      </AccountCard>

      <AccountCard
        title={methods.hasPassword ? 'Password' : 'Add a password'}
        description={
          methods.hasPassword
            ? 'Changing it signs you out everywhere else.'
            : 'So you can still sign in if Google is ever unavailable.'
        }
      >
        <PasswordForm hasPassword={methods.hasPassword} />
      </AccountCard>
    </div>
  );
}
