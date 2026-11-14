/*
 * lib/trade/messages.ts
 *
 * What a shopper is told about their trade account (ROADMAP 21.1), and the
 * invitation a merchant sends: the words and the links, built once. Server
 * only (it builds the shop's own addresses).
 *
 * The decision goes through notify() ('trade.decision'); the invitation is
 * sent directly, like a password reset, because it IS one — a link that sets
 * the first password of an account that can't sign in yet, so there is no
 * account for notify() to deliver to.
 */
import { prisma } from '@/lib/prisma';
import { notify } from '@/lib/notifications/notify';
import type { TradeDecision } from '@/lib/notifications/events';
import { sendStorefrontNoticeEmail } from '@/lib/email';
import { storeUrl } from '@/lib/storefront/account/return-url';
import { createPasswordResetToken, normalizeEmail } from '@/lib/storefront/account/shopper';
import type { StorefrontNoticeEmailProps } from '@/emails/storefront-notice';

/** An invitation link works for a week: people don't always read email the same day. */
export const INVITE_TTL_DAYS = 7;

async function storeOf(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, slug: true, customStoreDomain: true },
  });
}

function decisionEmail(
  store: { name: string },
  decision: TradeDecision,
  reason: string | null,
  accountUrl: string,
): StorefrontNoticeEmailProps {
  const footer = `You’re getting this because you have an account with ${store.name}.`;
  const why = reason ? [`Their note: “${reason}”`] : [];
  switch (decision) {
    case 'approved':
      return {
        storeName: store.name,
        subject: `Your trade account with ${store.name} is ready`,
        preview: 'You’re now a trade buyer.',
        heading: 'You’re now a trade buyer',
        paragraphs: [`${store.name} has approved your trade account. Sign in to shop with it.`],
        button: { label: 'See your trade account', url: accountUrl },
        footer,
      };
    case 'reinstated':
      return {
        storeName: store.name,
        subject: `Your trade account with ${store.name} is active again`,
        preview: 'Your trade account is active again.',
        heading: 'Your trade account is active again',
        paragraphs: [`${store.name} has turned your trade account back on.`],
        button: { label: 'See your trade account', url: accountUrl },
        footer,
      };
    case 'declined':
      return {
        storeName: store.name,
        subject: `About your trade account request with ${store.name}`,
        preview: 'The store replied to your request.',
        heading: 'About your trade account request',
        paragraphs: [`${store.name} can’t open a trade account for you at the moment.`, ...why, 'You can still shop with your normal account.'],
        button: { label: 'See your account', url: accountUrl },
        footer,
      };
    case 'suspended':
      return {
        storeName: store.name,
        subject: `Your trade account with ${store.name} is paused`,
        preview: 'Your trade account has been paused.',
        heading: 'Your trade account is paused',
        paragraphs: [
          `${store.name} has paused your trade account, so trade terms don’t apply for now.`,
          ...why,
          'Please contact the store if you have questions.',
        ],
        button: { label: 'See your account', url: accountUrl },
        footer,
      };
  }
}

/** Tell the shopper the merchant's answer. Call after the change has committed. */
export async function tellShopperTradeDecision(input: {
  organizationId: string;
  customerId: string;
  decision: TradeDecision;
  reason: string | null;
  actorUserId: string;
}): Promise<void> {
  const store = await storeOf(input.organizationId);
  if (!store) return;
  await notify({
    kind: 'trade.decision',
    organizationId: input.organizationId,
    facts: { customerId: input.customerId, storeName: store.name, decision: input.decision },
    email: { template: 'storefront-notice', props: decisionEmail(store, input.decision, input.reason, storeUrl(store, '/account/trade')) },
    actorUserId: input.actorUserId,
  });
}

/** Tell the team someone asked. Call after the request has committed. */
export async function tellStoreTradeRequest(input: { organizationId: string; customerId: string; businessName: string }): Promise<void> {
  await notify({
    kind: 'trade.request',
    organizationId: input.organizationId,
    facts: { customerId: input.customerId, businessName: input.businessName },
  });
}

export type InviteResult = 'sent' | 'has-sign-in' | 'no-email' | 'too-soon' | 'not-sent';

/**
 * Email a customer who can't sign in yet a link to set their password, in
 * the shop's name. A customer who already can sign in is told through
 * notify() instead (their decision email); one without an address can't be
 * invited at all.
 */
export async function sendTradeInvite(input: { organizationId: string; customerId: string; businessName: string }): Promise<InviteResult> {
  const [store, customer] = await Promise.all([
    storeOf(input.organizationId),
    prisma.customer.findFirst({
      where: { id: input.customerId, organizationId: input.organizationId, accountDeletedAt: null },
      select: { email: true, passwordHash: true, _count: { select: { oauthAccounts: true } } },
    }),
  ]);
  if (!store || !customer) return 'not-sent';
  if (!customer.email) return 'no-email';
  if (customer.passwordHash || customer._count.oauthAccounts > 0) return 'has-sign-in';

  /* A customer typed in by staff may have been saved as "Ada@Shop.com";
   * sign-in and the reset token look addresses up in lower case, so put it
   * that way first — unless another customer here already has it, in which
   * case this one can't be invited until they're merged. */
  const email = normalizeEmail(customer.email);
  if (email !== customer.email) {
    try {
      await prisma.customer.update({ where: { id: input.customerId }, data: { email } });
    } catch {
      return 'not-sent';
    }
  }

  const issued = await createPasswordResetToken({
    organizationId: input.organizationId,
    email,
    ttlMinutes: INVITE_TTL_DAYS * 24 * 60,
  });
  // One a minute at most (the reset token's own cooldown).
  if (!issued) return 'too-soon';

  const url = storeUrl(store, `/account/reset-password?token=${issued.rawToken}&invite=1`);
  const sent = await sendStorefrontNoticeEmail({
    to: [email],
    storeName: store.name,
    subject: `${store.name} invited you to buy wholesale`,
    preview: 'Set up your sign-in to shop with your trade account.',
    heading: 'You’re invited to buy wholesale',
    paragraphs: [
      `${store.name} has set up a trade account for ${input.businessName}.`,
      'Choose a password to sign in and shop with it.',
      `This link works once and expires in ${INVITE_TTL_DAYS} days.`,
    ],
    button: { label: 'Set up your sign-in', url },
    footer: `If you weren’t expecting this, you can ignore it — nothing happens until you choose a password.`,
  });
  return sent ? 'sent' : 'not-sent';
}
