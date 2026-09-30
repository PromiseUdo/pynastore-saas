/*
 * lib/domains/emails.ts
 *
 * The words of the domain emails (ROADMAP 12.6), built from facts the caller
 * passes; laid out by emails/platform-notice.tsx. Pure, so what each says is
 * tested without sending.
 */
import { PLATFORM_NAME } from '@/lib/brand';
import { formatDate, formatMoney } from '@/lib/format';
import type { PlatformNoticeEmailProps } from '@/emails/platform-notice';
import { renewalDeadline } from './rules';

type Email = PlatformNoticeEmailProps & { subject: string };

const footer = (shop: string) => `You’re receiving this about ${shop}’s web address on ${PLATFORM_NAME}.`;

export function domainLiveEmail(input: { shopName: string; host: string; renewed?: boolean; expiresAt?: Date | null; pageUrl: string }): Email {
  if (input.renewed) {
    return {
      subject: `${input.host} is renewed`,
      preview: `Your address is renewed${input.expiresAt ? ` until ${formatDate(input.expiresAt)}` : ''}`,
      heading: 'Your domain is renewed',
      paragraphs: [
        `${input.host} is renewed${input.expiresAt ? ` until ${formatDate(input.expiresAt)}` : ''}. Nothing else changes — your shop keeps working at it.`,
      ],
      button: { label: 'See your domain', url: input.pageUrl },
      footer: footer(input.shopName),
    };
  }
  return {
    subject: `Your shop is live at ${input.host}`,
    preview: `Customers can now find ${input.shopName} at ${input.host}`,
    heading: 'Your web address is live',
    paragraphs: [
      `Customers can now find ${input.shopName} at https://${input.host}. Your old shop address sends them there automatically, so links you’ve shared keep working.`,
      ...(input.expiresAt
        ? [`It’s registered until ${formatDate(input.expiresAt)}. We’ll remind you before it’s due to renew.`]
        : []),
    ],
    button: { label: 'Visit your shop', url: `https://${input.host}` },
    footer: footer(input.shopName),
  };
}

export function domainFailedEmail(input: { shopName: string; domain: string; reason: string; paid: boolean; pageUrl: string }): Email {
  return {
    subject: `We couldn’t set up ${input.domain}`,
    preview: 'Here’s what happened',
    heading: `We couldn’t set up ${input.domain}`,
    paragraphs: [
      `Here’s what happened: ${input.reason}`,
      input.paid
        ? 'Your payment for it is being returned to you. It can take a few working days to reach your account.'
        : 'Your shop keeps working at its current address.',
    ],
    button: { label: 'Choose another address', url: input.pageUrl },
    footer: footer(input.shopName),
  };
}

export function renewalReminderEmail(input: {
  shopName: string;
  domain: string;
  expiresAt: Date;
  renewNgn: number | null;
  pageUrl: string;
  /** the reminder key's first part: before_30…before_1, expired, grace_w1… */
  kind: string;
}): Email {
  const deadline = renewalDeadline(input.expiresAt);
  const price = input.renewNgn ? ` It costs ${formatMoney(input.renewNgn)} for a year.` : '';
  if (input.kind === 'expired' || input.kind.startsWith('grace_')) {
    return {
      subject: `${input.domain} has expired — renew to get it back`,
      preview: 'Your shop is back on its platform address until you renew',
      heading: `${input.domain} has expired`,
      paragraphs: [
        `It wasn’t renewed, so it stopped working on ${formatDate(input.expiresAt)}. Your shop is still open at its platform address.`,
        `You can still renew it at the normal price for a few weeks and get it back.${price} After that, getting it back costs much more, and then anyone can register it.`,
      ],
      button: { label: 'Renew now', url: input.pageUrl },
      footer: footer(input.shopName),
    };
  }
  const days = Number(input.kind.replace('before_', ''));
  return {
    subject: days <= 1 ? `Renew ${input.domain} today` : `Renew ${input.domain} by ${formatDate(deadline)}`,
    preview: `Your address stops working on ${formatDate(input.expiresAt)} unless it’s renewed`,
    heading: 'Time to renew your domain',
    paragraphs: [
      `${input.domain} is registered until ${formatDate(input.expiresAt)}. Renew it by ${formatDate(deadline)} so we have time to complete it with the registrar.${price}`,
      'If it isn’t renewed, your shop goes back to its platform address and the domain may be lost.',
    ],
    button: { label: 'Renew now', url: input.pageUrl },
    footer: `${footer(input.shopName)} We stop reminding you as soon as it’s renewed.`,
  };
}

export function staffRenewalDigest(input: {
  renewedAwaitingUs: { shop: string; domain: string; expiresAt: Date }[];
  notRenewed: { shop: string; domain: string; expiresAt: Date }[];
  queueUrl: string;
}): Email {
  const line = (d: { shop: string; domain: string; expiresAt: Date }) => `${d.domain} (${d.shop}) — expires ${formatDate(d.expiresAt)}`;
  return {
    subject: `Domains to renew: ${input.renewedAwaitingUs.length} paid, ${input.notRenewed.length} not renewed`,
    preview: 'Domains expiring within 14 days',
    heading: 'Domains expiring within 14 days',
    paragraphs: [
      input.renewedAwaitingUs.length
        ? `Renewed by the merchant — renew these at Namecheap: ${input.renewedAwaitingUs.map(line).join('; ')}.`
        : 'Nothing paid for is waiting to be renewed at Namecheap.',
      input.notRenewed.length ? `Not renewed by the merchant yet: ${input.notRenewed.map(line).join('; ')}.` : 'Every domain due has been renewed.',
    ],
    button: { label: 'Open the domain queue', url: input.queueUrl },
    footer: `Sent each morning by ${PLATFORM_NAME} while domains are due.`,
  };
}
