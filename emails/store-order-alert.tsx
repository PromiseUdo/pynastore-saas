/*
 * Telling a store's staff that a customer did something they need to answer:
 * cancelled an order, or asked to send items back.
 *
 * It says what happened, what the customer wrote, and the one thing to do
 * next, with a link straight to the order in the admin.
 */
import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';

export type StoreOrderAlertKind =
  | 'customer-cancelled'
  | 'return-requested'
  /* Delivery to be arranged (ROADMAP 21.4B): a trade order waiting for the store's delivery price */
  | 'delivery-to-price'
  | 'delivery-price-reminder'
  | 'delivery-not-priced';

/** The alerts about pricing an arranged delivery. */
const PRICING: StoreOrderAlertKind[] = ['delivery-to-price', 'delivery-price-reminder', 'delivery-not-priced'];

export type StoreOrderAlertEmailProps = {
  kind: StoreOrderAlertKind;
  storeName: string;
  reference: string;
  customerName: string;
  /** the order in the admin */
  orderUrl: string;
  /** already formatted, e.g. "₦12,500" */
  total: string;
  /** the order had been paid for, so the customer is owed a refund */
  wasPaid: boolean;
  /** the customer's own words, if they left any */
  customerNote?: string;
  /** return requests: why, and what is coming back */
  returnReason?: string;
  lines?: { name: string; quantity: number; total: string }[];
  /** pricing alerts: the store's deadline, already formatted */
  priceBy?: string;
};

export function storeOrderAlertSubject(props: Pick<StoreOrderAlertEmailProps, 'kind' | 'reference' | 'customerName'>) {
  switch (props.kind) {
    case 'customer-cancelled':
      return `${props.customerName} cancelled order ${props.reference}`;
    case 'return-requested':
      return `${props.customerName} asked to return items from ${props.reference}`;
    case 'delivery-to-price':
      return `Set the delivery price for order ${props.reference}`;
    case 'delivery-price-reminder':
      return `Reminder: set the delivery price for order ${props.reference}`;
    case 'delivery-not-priced':
      return `Order ${props.reference} was cancelled — delivery wasn’t priced in time`;
  }
}

/** The pricing alerts' words (21.4B). */
function PricingBody(props: StoreOrderAlertEmailProps) {
  if (props.kind === 'delivery-not-priced') {
    return (
      <Text style={paragraph}>
        Order <strong>{props.reference}</strong> from {props.customerName} was cancelled because its delivery wasn’t
        priced in time. Its stock has gone back on sale, and the customer has been told. They weren’t charged.
      </Text>
    );
  }
  return (
    <>
      <Text style={paragraph}>
        {props.customerName} placed trade order <strong>{props.reference}</strong> ({props.total} of goods) with{' '}
        <strong>delivery to be arranged</strong>. Work out what it costs to deliver and set the price on the order
        {props.priceBy ? <> by <strong>{props.priceBy}</strong></> : null}.
      </Text>
      <Text style={paragraph}>
        The stock is held for it meanwhile. They’ll see the price, accept it, then pay the way they chose. If it isn’t
        priced in time, the order is cancelled and the stock released.
      </Text>
    </>
  );
}

export function StoreOrderAlertEmail(props: StoreOrderAlertEmailProps) {
  const cancelled = props.kind === 'customer-cancelled';
  const pricing = PRICING.includes(props.kind);
  const heading = pricing
    ? props.kind === 'delivery-not-priced'
      ? 'An order was cancelled'
      : 'A delivery to price'
    : cancelled
      ? 'An order was cancelled'
      : 'A customer wants to return items';

  return (
    <Html>
      <Head />
      <Preview>{storeOrderAlertSubject(props)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{props.storeName}</Text>

          <Section style={card}>
            <Text style={headingStyle}>{heading}</Text>

            {pricing ? (
              <PricingBody {...props} />
            ) : cancelled ? (
              <>
                <Text style={paragraph}>
                  {props.customerName} cancelled order <strong>{props.reference}</strong> ({props.total}) before you
                  started packing it. Its stock has gone back on sale.
                </Text>
                {props.wasPaid && (
                  <Text style={paragraph}>
                    <strong>They had already paid.</strong> Send the money back from your own bank account — online
                    payments were paid into it — then record the refund on the order so they can see it.
                  </Text>
                )}
              </>
            ) : (
              <>
                <Text style={paragraph}>
                  {props.customerName} asked to return items from order <strong>{props.reference}</strong>
                  {props.returnReason ? ` — “${props.returnReason}”.` : '.'}
                </Text>
                {props.lines?.map((line, index) => (
                  <Text key={`${line.name}-${index}`} style={lineText}>
                    {line.name} × {line.quantity} · {line.total}
                  </Text>
                ))}
                <Text style={paragraph}>
                  Approve it and tell them how to send it back, or decline it with a reason. They’ll be emailed
                  either way.
                </Text>
              </>
            )}

            {props.customerNote && (
              <Text style={quote}>
                “{props.customerNote}”
              </Text>
            )}

            <Button style={button} href={props.orderUrl}>
              Open the order
            </Button>

            <Hr style={hr} />

            <Text style={footer}>
              You’re receiving this because your role manages {cancelled || pricing ? 'orders' : 'returns'} for {props.storeName}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default StoreOrderAlertEmail;

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const main: React.CSSProperties = {
  backgroundColor: '#f5f5f4',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '40px 20px' };
const logo: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: '700',
  color: '#18181b',
  textAlign: 'center',
  marginBottom: '32px',
};
const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  border: '1px solid #e4e4e7',
  padding: '32px',
};
const headingStyle: React.CSSProperties = { fontSize: '22px', fontWeight: '600', color: '#18181b', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#3f3f46', margin: '0 0 16px' };
const lineText: React.CSSProperties = { fontSize: '14px', lineHeight: '20px', color: '#3f3f46', margin: '0 0 6px' };
const quote: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#3f3f46',
  borderLeft: '3px solid #e4e4e7',
  padding: '4px 0 4px 12px',
  margin: '0 0 16px',
};
const button: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#18181b',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '500',
  textDecoration: 'none',
  borderRadius: '8px',
  padding: '12px 24px',
};
const hr: React.CSSProperties = { borderColor: '#e4e4e7', margin: '24px 0' };
const footer: React.CSSProperties = { fontSize: '13px', lineHeight: '20px', color: '#71717a', margin: 0 };
