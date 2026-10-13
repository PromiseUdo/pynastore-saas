/*
 * lib/notifications/channels/email.ts
 *
 * The email channel (ROADMAP 18.1): which template an event's email uses,
 * and handing it to lib/email.ts. The producer builds the template's props
 * (it has the order, the lines, the address); the seam decides who it goes
 * to. One delivery is one message, to every address it names — as each of
 * these emails always went.
 *
 * Stored in the outbox as JSON, so props are plain data.
 */
import {
  sendChatMessageAlertEmail,
  sendDomainOrderNotificationEmail,
  sendPaymentDisputeEmail,
  sendPlatformNoticeEmail,
  sendStoreOrderAlertEmail,
  sendStorefrontOrderUpdateEmail,
  type DomainOrderNotificationEmailPayload,
} from '@/lib/email';
import type { StorefrontOrderUpdateEmailProps } from '@/emails/storefront-order-update';
import type { StoreOrderAlertEmailProps } from '@/emails/store-order-alert';
import type { ChatMessageAlertEmailProps } from '@/emails/chat-message-alert';
import type { PaymentDisputeEmailProps } from '@/emails/payment-dispute';
import type { PlatformNoticeEmailProps } from '@/emails/platform-notice';

export type EmailMessage =
  | { template: 'storefront-order-update'; props: StorefrontOrderUpdateEmailProps }
  | { template: 'store-order-alert'; props: StoreOrderAlertEmailProps }
  | { template: 'chat-message-alert'; props: ChatMessageAlertEmailProps }
  | { template: 'payment-dispute'; props: PaymentDisputeEmailProps }
  | { template: 'platform-notice'; props: PlatformNoticeEmailProps & { subject: string } }
  | { template: 'domain-order'; props: Omit<DomainOrderNotificationEmailPayload, 'to'> };

/** Whether the provider accepted it. A `false` is retried by the outbox. */
export async function sendEmailMessage(message: EmailMessage, to: string[]): Promise<boolean> {
  if (to.length === 0) return false;
  // The mocks in tests resolve to undefined: anything but an explicit false is a send.
  const accepted = async (sent: Promise<boolean | void>) => (await sent) !== false;

  switch (message.template) {
    case 'storefront-order-update': {
      // A shopper's own order email: one address, one message each.
      let all = true;
      for (const address of to) all = (await accepted(sendStorefrontOrderUpdateEmail({ ...message.props, to: address }))) && all;
      return all;
    }
    case 'store-order-alert':
      return accepted(sendStoreOrderAlertEmail({ ...message.props, to }));
    case 'chat-message-alert':
      return accepted(sendChatMessageAlertEmail({ ...message.props, to }));
    case 'payment-dispute':
      return accepted(sendPaymentDisputeEmail({ ...message.props, to }));
    case 'platform-notice':
      return accepted(sendPlatformNoticeEmail({ ...message.props, to }));
    case 'domain-order':
      return accepted(sendDomainOrderNotificationEmail({ ...message.props, to }));
  }
}
