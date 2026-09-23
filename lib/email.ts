/*
 * lib/email.ts
 *
 * Email delivery via Resend. Never throws — failures are logged and swallowed
 * so that a broken email provider never kills an otherwise-valid operation.
 */
import { Resend } from 'resend';
import { InvitationEmail } from '@/emails/invitation';
import { ResetPasswordEmail } from '@/emails/reset-password';
import { StorefrontResetPasswordEmail } from '@/emails/storefront-reset-password';
import { StorefrontConfirmEmailChangeEmail } from '@/emails/storefront-confirm-email';
import { StorefrontEmailChangeNoticeEmail } from '@/emails/storefront-email-change-notice';
import { LowStockAlertEmail } from '@/emails/low-stock-alert';
import {
  StoreOrderAlertEmail,
  storeOrderAlertSubject,
  type StoreOrderAlertEmailProps,
} from '@/emails/store-order-alert';
import { DomainOrderNotificationEmail } from '@/emails/domain-order-notification';
import { InvoiceEmail, type InvoiceEmailProps } from '@/emails/invoice';
import {
  StorefrontOrderUpdateEmail,
  orderEmailSubject,
  type StorefrontOrderUpdateEmailProps,
} from '@/emails/storefront-order-update';
import { PLATFORM_NAME } from '@/lib/brand';

const resend = new Resend(process.env.RESEND_API_KEY);

/*
 * Every message leaves from the platform's own verified sender. There is no
 * hard-coded fallback: an unset EMAIL_FROM is a misconfiguration, and sending
 * from someone else's domain would silently fail SPF/DKIM anyway. `sendFrom()`
 * logs and the caller skips the send, which matches this module's contract of
 * never throwing.
 *
 * Per-merchant sending domains are a Phase 3 decision (docs/ROADMAP.md).
 */
const FROM = process.env.EMAIL_FROM;

function sendFrom(): string | null {
  if (!FROM) {
    console.error('[email] EMAIL_FROM is not set — no email was sent.');
    return null;
  }
  return FROM;
}

type InvitationEmailPayload = {
  to: string;
  orgName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
};

export async function sendInvitationEmail(
  payload: InvitationEmailPayload,
): Promise<void> {
  try {
    const from = sendFrom();
    if (!from) return;
    await resend.emails.send({
      from,
      to: payload.to,
      subject: `You've been invited to ${payload.orgName} on ${PLATFORM_NAME}`,
      react: InvitationEmail(payload),
    });
  } catch (err) {
    console.error('[email] Failed to send invitation email:', err);
  }
}

type ResetPasswordEmailPayload = {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
};

export async function sendPasswordResetEmail(
  payload: ResetPasswordEmailPayload,
): Promise<void> {
  try {
    const from = sendFrom();
    if (!from) return;
    await resend.emails.send({
      from,
      to: payload.to,
      subject: `Reset your ${PLATFORM_NAME} password`,
      react: ResetPasswordEmail(payload),
    });
  } catch (err) {
    console.error('[email] Failed to send password reset email:', err);
  }
}

type StorefrontPasswordResetPayload = {
  to: string;
  storeName: string;
  resetUrl: string;
  expiresInMinutes: number;
};

/**
 * Password reset for a shopper. Sent in the merchant's name, not the
 * platform's — see emails/storefront-reset-password.tsx.
 */
export async function sendStorefrontPasswordResetEmail(
  payload: StorefrontPasswordResetPayload,
): Promise<void> {
  try {
    const from = sendFrom();
    if (!from) return;
    await resend.emails.send({
      from,
      to: payload.to,
      subject: `Reset your ${payload.storeName} password`,
      react: StorefrontResetPasswordEmail(payload),
    });
  } catch (err) {
    console.error('[email] Failed to send storefront password reset email:', err);
  }
}

type ConfirmEmailChangePayload = {
  to: string;
  storeName: string;
  confirmUrl: string;
  expiresInMinutes: number;
};

/** Goes to the NEW address: the account doesn't move until this is opened. */
export async function sendStorefrontConfirmEmailChange(
  payload: ConfirmEmailChangePayload,
): Promise<void> {
  try {
    const from = sendFrom();
    if (!from) return;
    await resend.emails.send({
      from,
      to: payload.to,
      subject: `Confirm this email for your ${payload.storeName} account`,
      react: StorefrontConfirmEmailChangeEmail(payload),
    });
  } catch (err) {
    console.error('[email] Failed to send email-change confirmation:', err);
  }
}

type EmailChangeNoticePayload = {
  to: string;
  storeName: string;
  newEmail: string;
  resetUrl: string;
};

/** Goes to the OLD address, at request time — the account holder's warning. */
export async function sendStorefrontEmailChangeNotice(
  payload: EmailChangeNoticePayload,
): Promise<void> {
  try {
    const from = sendFrom();
    if (!from) return;
    await resend.emails.send({
      from,
      to: payload.to,
      subject: `Someone asked to change the email on your ${payload.storeName} account`,
      react: StorefrontEmailChangeNoticeEmail(payload),
    });
  } catch (err) {
    console.error('[email] Failed to send email-change notice:', err);
  }
}

/** A customer cancelled, or asked to return items — sent to the store's staff. */
export async function sendStoreOrderAlertEmail(payload: StoreOrderAlertEmailProps & { to: string[] }): Promise<void> {
  if (payload.to.length === 0) return;
  try {
    const from = sendFrom();
    if (!from) return;
    const { to, ...props } = payload;
    await resend.emails.send({
      from,
      to,
      subject: storeOrderAlertSubject(props),
      react: StoreOrderAlertEmail(props),
    });
  } catch (err) {
    console.error('[email] Failed to send store order alert email:', err);
  }
}

type LowStockAlertEmailPayload = {
  to: string[];
  itemName: string;
  sku: string;
  warehouseName: string;
  quantity: number;
  reorderPoint: number;
  inventoryUrl: string;
};

export async function sendLowStockAlertEmail(
  payload: LowStockAlertEmailPayload,
): Promise<void> {
  if (payload.to.length === 0) return;
  try {
    const from = sendFrom();
    if (!from) return;
    await resend.emails.send({
      from,
      to: payload.to,
      subject: `Low stock: ${payload.itemName} at ${payload.warehouseName}`,
      react: LowStockAlertEmail(payload),
    });
  } catch (err) {
    console.error('[email] Failed to send low stock alert email:', err);
  }
}

type DomainOrderNotificationEmailPayload = {
  orgName: string;
  orgSlug: string;
  domainOrderType: 'EXISTING' | 'REGISTER';
  domain: string;
};

/** Notifies platform admins that a new domain order needs manual fulfillment (registration/DNS). */
export async function sendDomainOrderNotificationEmail(
  payload: DomainOrderNotificationEmailPayload,
): Promise<void> {
  const to = process.env.PLATFORM_ADMIN_EMAIL;
  if (!to) {
    console.warn('[email] PLATFORM_ADMIN_EMAIL is not configured — skipping domain order notification.');
    return;
  }
  try {
    const from = sendFrom();
    if (!from) return;
    await resend.emails.send({
      from,
      to,
      subject: `New domain order: ${payload.domain} (${payload.orgName})`,
      react: DomainOrderNotificationEmail(payload),
    });
  } catch (err) {
    console.error('[email] Failed to send domain order notification email:', err);
  }
}

/** Tells a shopper where their order has got to — see lib/storefront/orders/notifications.ts. */
/**
 * An invoice, or a reminder about one — sent in the merchant's name, to their
 * customer. Carries the merchant's own logo and name; nothing in it mentions
 * the platform.
 */
export async function sendInvoiceEmail(payload: InvoiceEmailProps & { to: string }): Promise<void> {
  try {
    const from = sendFrom();
    if (!from) return;
    const { to, ...props } = payload;
    await resend.emails.send({
      from,
      to,
      subject:
        props.kind === 'reminder'
          ? `Reminder: invoice ${props.invoiceNumber} from ${props.businessName}`
          : `Invoice ${props.invoiceNumber} from ${props.businessName}`,
      react: InvoiceEmail(props),
    });
  } catch (err) {
    console.error('[email] Failed to send invoice email:', err);
  }
}

export async function sendStorefrontOrderUpdateEmail(
  payload: StorefrontOrderUpdateEmailProps & { to: string },
): Promise<void> {
  try {
    const from = sendFrom();
    if (!from) return;
    const { to, ...props } = payload;
    await resend.emails.send({
      from,
      to,
      subject: orderEmailSubject(props.kind, props.storeName, props.reference),
      react: StorefrontOrderUpdateEmail(props),
    });
  } catch (err) {
    console.error('[email] Failed to send storefront order update email:', err);
  }
}
