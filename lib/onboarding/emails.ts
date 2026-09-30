/*
 * lib/onboarding/emails.ts
 *
 * The words of the onboarding emails (ROADMAP 12.5), built from facts the
 * caller passes. Pure, so what each says can be tested without sending.
 * Laid out by emails/platform-notice.tsx.
 */
import { PLATFORM_NAME } from '@/lib/brand';
import { formatDate } from '@/lib/format';
import type { PlatformNoticeEmailProps } from '@/emails/platform-notice';

type Email = PlatformNoticeEmailProps & { subject: string };

export function verifyEmail(input: { name: string | null; url: string; expiresInHours: number }): Email {
  return {
    subject: `Confirm your email for ${PLATFORM_NAME}`,
    preview: 'Confirm your email to create your shop',
    heading: 'Confirm your email',
    paragraphs: [
      `${input.name ? `Hi ${input.name}, t` : 'T'}hanks for signing up to ${PLATFORM_NAME}. Confirm this is your email address and you can create your shop straight away.`,
      `The link works for ${input.expiresInHours} hours.`,
    ],
    button: { label: 'Confirm my email', url: input.url },
    showUrl: true,
    footer: `If you didn’t sign up to ${PLATFORM_NAME}, you can ignore this email — nothing will be set up.`,
  };
}

export function welcomeEmail(input: {
  shopName: string;
  storefrontUrl: string;
  adminUrl: string;
  trial: { planName: string; endsAt: Date } | null;
  firstStep: string | null;
}): Email {
  return {
    subject: `Welcome to ${PLATFORM_NAME} — ${input.shopName} is set up`,
    preview: `${input.shopName} is set up. Here’s what to do next.`,
    heading: `${input.shopName} is set up`,
    paragraphs: [
      `Your dashboard is at ${input.adminUrl}. Your shop will be at ${input.storefrontUrl} — it shows “Opening soon” until you open it.`,
      ...(input.trial
        ? [`You’re on a free trial of ${input.trial.planName} until ${formatDate(input.trial.endsAt)}. No card is needed until you choose a plan.`]
        : []),
      input.firstStep
        ? `Your dashboard has a short guide to get your shop ready. First: ${input.firstStep.toLowerCase()}.`
        : 'Your dashboard has a short guide to get your shop ready.',
    ],
    button: { label: 'Open your dashboard', url: input.adminUrl },
    footer: `You’re receiving this because you created ${input.shopName} on ${PLATFORM_NAME}.`,
  };
}

export function setupReminderEmail(input: { shopName: string; stepsLeft: string[]; adminUrl: string; day: 3 | 7 }): Email {
  return {
    subject: input.day === 3 ? `A few steps left to open ${input.shopName}` : `${input.shopName} isn’t open yet`,
    preview: `${input.stepsLeft.length} step${input.stepsLeft.length === 1 ? '' : 's'} left before customers can order`,
    heading: input.day === 3 ? 'A few steps left' : 'Your shop isn’t open yet',
    paragraphs: [
      `Customers can’t order from ${input.shopName} until these are done:`,
    ],
    list: input.stepsLeft,
    button: { label: 'Continue setting up', url: input.adminUrl },
    footer: `You’re receiving this because you own ${input.shopName} on ${PLATFORM_NAME}. We only send it while setup isn’t finished.`,
  };
}

export function trialEndingEmail(input: {
  shopName: string;
  planName: string;
  endsAt: Date;
  graceDays: number;
  upgradeUrl: string;
  daysLeft: number;
}): Email {
  const when = input.daysLeft <= 1 ? 'tomorrow' : `in ${input.daysLeft} days`;
  return {
    subject: `Your ${PLATFORM_NAME} trial ends ${when}`,
    preview: `Choose a plan to keep ${input.shopName} running`,
    heading: `Your free trial ends ${when}`,
    paragraphs: [
      `Your free trial of ${input.planName} for ${input.shopName} ends on ${formatDate(input.endsAt)}.`,
      input.graceDays > 0
        ? `Choose a plan to keep everything running. If you don’t, your shop keeps taking orders for ${input.graceDays} more day${input.graceDays === 1 ? '' : 's'}, then closes until you do. Nothing is deleted.`
        : 'Choose a plan to keep everything running. If you don’t, your shop closes when the trial ends, until you do. Nothing is deleted.',
    ],
    button: { label: 'Choose a plan', url: input.upgradeUrl },
    footer: `You’re receiving this because you own ${input.shopName} on ${PLATFORM_NAME}.`,
  };
}
