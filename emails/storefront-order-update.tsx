/*
 * An update about a shopper's order, sent in the merchant's name.
 *
 * One template for every stage, because every stage is the same message: what
 * happened, what (if anything) the shopper needs to do, what they ordered, and
 * a link back to the order. Like the other storefront emails it never mentions
 * the platform — the shopper bought from the store, not from us.
 *
 * Every sentence restates something the app actually did. Nothing here says
 * "out for delivery today", and a refund is only ever "the store says it has
 * sent" — the app records refunds, it doesn't make them.
 */
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export type OrderEmailKind =
  | 'placed-pay-on-delivery'
  | 'placed-bank-transfer'
  | 'payment-received'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'cancelled-by-you'
  | 'payment-timeout'
  | 'return-requested'
  | 'return-approved'
  | 'return-rejected'
  | 'refunded';

export type StorefrontOrderUpdateEmailProps = {
  kind: OrderEmailKind;
  storeName: string;
  firstName: string;
  reference: string;
  orderUrl: string;
  /** already formatted, e.g. "₦12,500.00" */
  total: string;
  lines: { name: string; quantity: number; total: string }[];
  deliveryLabel: string;
  address: string[];
  /** a cancelled order that had been paid for */
  wasPaid?: boolean;
  /** bank transfer: where to send the money, and how long they have */
  transferAccounts?: { bankName: string; accountName: string; accountNumber: string }[];
  transferHoldHours?: number;
  /** return emails: why the shopper is sending it back (set = `lines` are the returned items) */
  returnReason?: string;
  /** what the store wrote: how to send it back, or why not */
  storeNote?: string;
  /** refund emails: the amount the store recorded, formatted */
  refundAmount?: string;
};

const COPY: Record<OrderEmailKind, { subject: string; heading: string }> = {
  'placed-pay-on-delivery': { subject: 'We’ve got your order', heading: 'Thanks — we’ve got your order' },
  'placed-bank-transfer': { subject: 'Your order: how to pay by bank transfer', heading: 'Thanks — now send your transfer' },
  'payment-received': { subject: 'Payment received — order confirmed', heading: 'Your order is confirmed' },
  shipped: { subject: 'Your order is on its way', heading: 'Your order is on its way' },
  delivered: { subject: 'Your order was delivered', heading: 'Your order was delivered' },
  cancelled: { subject: 'Your order was cancelled', heading: 'Your order was cancelled' },
  'cancelled-by-you': { subject: 'You cancelled your order', heading: 'Your order is cancelled' },
  'payment-timeout': { subject: 'Your order wasn’t completed', heading: 'We didn’t receive your payment' },
  'return-requested': { subject: 'We’ve sent your return request', heading: 'Your return request is in' },
  'return-approved': { subject: 'Your return was approved', heading: 'Your return was approved' },
  'return-rejected': { subject: 'About your return request', heading: 'Your return request was declined' },
  refunded: { subject: 'Your refund has been sent', heading: 'Your refund has been sent' },
};

export function orderEmailSubject(kind: OrderEmailKind, storeName: string, reference: string): string {
  return `${COPY[kind].subject} (${reference}) · ${storeName}`;
}

function body(props: StorefrontOrderUpdateEmailProps): string[] {
  switch (props.kind) {
    case 'placed-pay-on-delivery':
      return [
        `${props.storeName} has your order and will get it ready.`,
        `You chose to pay on delivery: have ${props.total} ready for the courier when it arrives.`,
      ];
    case 'placed-bank-transfer':
      return [
        `${props.storeName} has set your items aside. Transfer exactly ${props.total} to the account below within ${props.transferHoldHours ?? 48} hours, using your order number as the reference.`,
        'The store confirms your order once the money reaches them, and we’ll email you when they do. If it hasn’t arrived in time, the order is cancelled.',
      ];
    case 'payment-received':
      return [`We’ve received your payment of ${props.total}, and ${props.storeName} is getting your order ready.`];
    case 'shipped':
      return [`${props.storeName} has sent your order. It’s on its way to the address below.`];
    case 'delivered':
      return ['Your order has been marked as delivered. We hope it’s just right.'];
    case 'cancelled':
      return props.wasPaid
        ? [
            `${props.storeName} has cancelled this order.`,
            `You had already paid, so the store owes you ${props.total}. We’ll email you again when they’ve sent it back, and your order page will show it too.`,
          ]
        : [`${props.storeName} has cancelled this order. You haven’t been charged for it.`];
    case 'cancelled-by-you':
      return props.wasPaid
        ? [
            'You’ve cancelled this order and its items have gone back on sale.',
            `You had already paid, so ${props.storeName} owes you ${props.total}. We’ll email you when they’ve sent it back, and your order page will show it too.`,
          ]
        : ['You’ve cancelled this order and its items have gone back on sale. You haven’t been charged for it.'];
    case 'return-requested':
      return [
        `${props.storeName} has your request to send back the items below${props.returnReason ? ` (“${props.returnReason}”)` : ''}.`,
        'Please hold on to them for now — the store will reply with how to send them back, and we’ll email you when they do.',
      ];
    case 'return-approved':
      return [
        `${props.storeName} has approved your return of the items below.`,
        props.storeNote
          ? 'Here’s how they’d like you to send them back:'
          : 'They’ll be in touch about how to send them back.',
      ];
    case 'return-rejected':
      return [`${props.storeName} can’t accept the return of the items below. Here’s what they said:`];
    case 'refunded':
      return [
        props.refundAmount
          ? `${props.storeName} says they’ve sent ${props.refundAmount} back to you.`
          : `${props.storeName} says they’ve sent your refund.`,
        'Depending on how you paid, it can take a few working days to reach your account. If it hasn’t arrived after that, reply to this email.',
      ];
    case 'payment-timeout':
      return [
        'Your payment didn’t come through in time, so we’ve cancelled the order and put the items back on sale. You haven’t been charged.',
        'If you still want them, you’re welcome to order again.',
      ];
  }
}

export function StorefrontOrderUpdateEmail(props: StorefrontOrderUpdateEmailProps) {
  const copy = COPY[props.kind];
  const aboutReturn = props.returnReason !== undefined;
  const showDelivery = ['placed-pay-on-delivery', 'placed-bank-transfer', 'payment-received', 'shipped', 'delivered'].includes(
    props.kind,
  );

  return (
    <Html>
      <Head />
      <Preview>
        {copy.heading} — order {props.reference}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{props.storeName}</Text>

          <Section style={card}>
            <Text style={heading}>{copy.heading}</Text>
            {props.firstName && <Text style={paragraph}>Hi {props.firstName},</Text>}
            {body(props).map((sentence) => (
              <Text key={sentence} style={paragraph}>
                {sentence}
              </Text>
            ))}

            {props.storeNote && (props.kind === 'return-approved' || props.kind === 'return-rejected') && (
              <Text style={storeNote}>{props.storeNote}</Text>
            )}

            <Text style={reference}>Order {props.reference}</Text>

            {props.kind === 'placed-bank-transfer' &&
              props.transferAccounts?.map((account, index) => (
                <Section key={`${account.accountNumber}-${index}`} style={transferBox}>
                  <Text style={label}>Pay into</Text>
                  <Text style={addressLine}>{account.bankName}</Text>
                  <Text style={addressLine}>{account.accountName}</Text>
                  <Text style={accountNumber}>{account.accountNumber}</Text>
                  <Text style={label}>Amount · reference</Text>
                  <Text style={addressLine}>
                    {props.total} · {props.reference}
                  </Text>
                </Section>
              ))}

            <Hr style={hr} />

            {props.lines.map((line, index) => (
              <table key={`${line.name}-${index}`} width="100%" cellPadding={0} cellSpacing={0} style={row}>
                <tbody>
                  <tr>
                    <td style={lineName}>
                      {line.name} × {line.quantity}
                    </td>
                    <td style={lineTotal}>{line.total}</td>
                  </tr>
                </tbody>
              </table>
            ))}
            {/* A return lists only what's going back, so an order total under it would mislead. */}
            {(!aboutReturn || props.refundAmount) && (
              <table width="100%" cellPadding={0} cellSpacing={0} style={row}>
                <tbody>
                  <tr>
                    <td style={totalLabel}>{props.refundAmount ? 'Refunded' : 'Total'}</td>
                    <td style={totalValue}>{props.refundAmount ?? props.total}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {showDelivery && (
              <>
                <Hr style={hr} />
                <Text style={label}>{props.deliveryLabel} to</Text>
                {props.address.map((part) => (
                  <Text key={part} style={addressLine}>
                    {part}
                  </Text>
                ))}
              </>
            )}

            <Button style={button} href={props.orderUrl}>
              View your order
            </Button>

            <Text style={footer}>Keep your order number handy if you get in touch with {props.storeName}.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default StorefrontOrderUpdateEmail;

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const main: React.CSSProperties = {
  backgroundColor: '#f6f2e2',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '40px 20px' };
const logo: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: '700',
  color: '#001822',
  textAlign: 'center',
  marginBottom: '32px',
};
const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '16px',
  border: '1px solid #e7e2cf',
  padding: '32px',
};
const heading: React.CSSProperties = { fontSize: '22px', fontWeight: '600', color: '#001822', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#3f4a4f', margin: '0 0 12px' };
const reference: React.CSSProperties = { fontSize: '14px', fontWeight: '600', color: '#001822', margin: '8px 0 0' };
const hr: React.CSSProperties = { borderColor: '#e7e2cf', margin: '20px 0' };
const row: React.CSSProperties = { marginBottom: '8px' };
const lineName: React.CSSProperties = { fontSize: '14px', color: '#3f4a4f' };
const lineTotal: React.CSSProperties = { fontSize: '14px', color: '#3f4a4f', textAlign: 'right', whiteSpace: 'nowrap' };
const totalLabel: React.CSSProperties = { fontSize: '15px', fontWeight: '600', color: '#001822', paddingTop: '8px' };
const totalValue: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: '700',
  color: '#001822',
  textAlign: 'right',
  paddingTop: '8px',
};
const label: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#6b7478',
  margin: '0 0 6px',
};
const addressLine: React.CSSProperties = { fontSize: '14px', lineHeight: '20px', color: '#3f4a4f', margin: '0' };
const button: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#001822',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  borderRadius: '999px',
  padding: '12px 24px',
  margin: '24px 0 16px',
};
const transferBox: React.CSSProperties = {
  border: '1px solid #e7e2cf',
  borderRadius: '12px',
  padding: '16px',
  margin: '16px 0 0',
};
const accountNumber: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: '700',
  letterSpacing: '0.04em',
  color: '#001822',
  margin: '4px 0 12px',
};
const storeNote: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '24px',
  color: '#001822',
  whiteSpace: 'pre-line',
  borderLeft: '3px solid #e7e2cf',
  padding: '4px 0 4px 14px',
  margin: '0 0 12px',
};
const footer: React.CSSProperties = { fontSize: '13px', lineHeight: '20px', color: '#6b7478', margin: '0' };
