/*
 * lib/mobile/emails.ts
 *
 * The words of the store-app emails (ROADMAP 16.2), built from facts the
 * caller passes; laid out by emails/platform-notice.tsx. Pure, so what each
 * one says is tested without sending.
 */
import { PLATFORM_NAME } from '@/lib/brand';
import { formatDate, formatMoney } from '@/lib/format';
import type { PlatformNoticeEmailProps } from '@/emails/platform-notice';

type Email = PlatformNoticeEmailProps & { subject: string };

const footer = (shop: string) => `You’re receiving this about ${shop}’s phone app on ${PLATFORM_NAME}.`;
const platformsText = (p: { android: boolean; ios: boolean }) =>
  p.android && p.ios ? 'Android and iPhone' : p.android ? 'Android' : 'iPhone';

/** To staff: a merchant paid, so there's an app to build. */
export function appPaidStaffEmail(input: {
  shopName: string;
  appName: string;
  platforms: { android: boolean; ios: boolean };
  queueUrl: string;
}): Email {
  return {
    subject: `New store app to build: ${input.appName} (${input.shopName})`,
    preview: `${input.shopName} paid for their ${platformsText(input.platforms)} app`,
    heading: 'A store app to build',
    paragraphs: [
      `${input.shopName} paid for their own app, “${input.appName}”, for ${platformsText(input.platforms)}.`,
      'Their icon, colour and details are on the order. Build it with the kit (docs/MOBILE-BUILD.md), then mark it delivered.',
    ],
    button: { label: 'Open the order', url: input.queueUrl },
    footer: `Sent to ${PLATFORM_NAME} staff.`,
  };
}

export function appDeliveredEmail(input: {
  shopName: string;
  appName: string;
  versionName: string;
  platforms: { android: boolean; ios: boolean };
  hasDownload: boolean;
  pageUrl: string;
}): Email {
  return {
    subject: `Your app “${input.appName}” is ready to publish`,
    preview: 'The next step is publishing it in the stores',
    heading: 'Your app is ready',
    paragraphs: [
      `We’ve finished building “${input.appName}” (version ${input.versionName}) for ${platformsText(input.platforms)}.`,
      ...(input.platforms.android
        ? [
            input.hasDownload
              ? 'The Android files are ready to download from your Mobile app page. Upload the .aab file to your Google Play account; the .apk can be installed on a phone straight away.'
              : 'We’ll send you the Android files separately.',
          ]
        : []),
      ...(input.platforms.ios ? ['The iPhone build is in your App Store Connect account, ready for you to submit for review.'] : []),
      'Your Mobile app page has the store listing pack: the links, privacy answers and screenshots both stores ask for.',
    ],
    button: { label: 'Open your Mobile app page', url: input.pageUrl },
    footer: footer(input.shopName),
  };
}

export function appLiveEmail(input: { shopName: string; appName: string; stores: string[]; pageUrl: string }): Email {
  return {
    subject: `“${input.appName}” is live`,
    preview: `Customers can now download it from ${input.stores.join(' and ')}`,
    heading: 'Your app is live',
    paragraphs: [
      `Customers can now download “${input.appName}” from ${input.stores.join(' and ')}.`,
      'Your website now offers it too: a “Get our app” banner on phones, a link in the footer, and a page with a QR code. You can turn that off on your Mobile app page.',
    ],
    button: { label: 'Open your Mobile app page', url: input.pageUrl },
    footer: footer(input.shopName),
  };
}

export function appRenewalReminderEmail(input: {
  shopName: string;
  appName: string;
  paidThrough: Date;
  days: number;
  price: number | null;
  pageUrl: string;
}): Email {
  const when = input.days <= 1 ? 'tomorrow' : `in ${input.days} days`;
  return {
    subject: `Renew “${input.appName}” — its year ends ${when}`,
    preview: `Paid until ${formatDate(input.paidThrough)}`,
    heading: 'Time to renew your app',
    paragraphs: [
      `“${input.appName}” is paid until ${formatDate(input.paidThrough)}.${input.price !== null ? ` Another year costs ${formatMoney(input.price)}.` : ''}`,
      'If it isn’t renewed, the app keeps working for a short while, then shows customers that it’s no longer available.',
    ],
    button: { label: 'Renew your app', url: input.pageUrl },
    footer: footer(input.shopName),
  };
}

export function appGraceEmail(input: { shopName: string; appName: string; graceEndsAt: Date; price: number | null; pageUrl: string }): Email {
  return {
    subject: `“${input.appName}” needs renewing`,
    preview: `It stops working on ${formatDate(input.graceEndsAt)} unless it’s renewed`,
    heading: 'Your app’s year has ended',
    paragraphs: [
      `The year you paid for “${input.appName}” has ended. It keeps working until ${formatDate(input.graceEndsAt)}.`,
      `After that, customers who open it see that it’s no longer available, with a link to your website.${input.price !== null ? ` Renewing costs ${formatMoney(input.price)} for a year.` : ''}`,
    ],
    button: { label: 'Renew your app', url: input.pageUrl },
    footer: footer(input.shopName),
  };
}

export function appLapsedEmail(input: { shopName: string; appName: string; price: number | null; pageUrl: string }): Email {
  return {
    subject: `“${input.appName}” is switched off`,
    preview: 'Renew it to switch it back on',
    heading: 'Your app is switched off',
    paragraphs: [
      `“${input.appName}” wasn’t renewed, so customers who open it now see that it’s no longer available, with a link to your website.`,
      `Renew it and it works again straight away — nobody has to reinstall anything.${input.price !== null ? ` A year costs ${formatMoney(input.price)}.` : ''}`,
    ],
    button: { label: 'Renew your app', url: input.pageUrl },
    footer: footer(input.shopName),
  };
}
