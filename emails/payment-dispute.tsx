import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';
import { PLATFORM_NAME } from '@/lib/brand';

/*
 * A customer's bank opened (or settled) a chargeback on an online payment
 * (ROADMAP 10.5). Sent to the shop's staff who handle orders, and to the
 * platform, which receives Paystack's dispute notices. It asks for what a
 * dispute is usually won with — proof the goods were delivered — and makes no
 * claim about whose money a lost dispute comes from, which Paystack hasn't
 * confirmed (ROADMAP 10.13).
 */
export type PaymentDisputeEmailProps = {
  kind: 'opened' | 'resolved';
  storeName: string;
  reference: string;
  amount: string;
  /** Paystack's deadline for a response, formatted */
  dueDate: string | null;
  /** 'merchant-accepted' | 'declined' once resolved */
  resolution: string | null;
  orderUrl: string;
};

export function paymentDisputeSubject({ kind, reference }: Pick<PaymentDisputeEmailProps, 'kind' | 'reference'>): string {
  return kind === 'opened' ? `Chargeback opened on order ${reference}` : `Chargeback on order ${reference} is settled`;
}

function outcomeLine(resolution: string | null): string {
  if (resolution === 'declined') return 'The dispute was decided in the store’s favour: the payment stands.';
  if (resolution === 'merchant-accepted') return 'The dispute was accepted: the customer’s bank takes the payment back.';
  return 'Paystack has marked the dispute as settled.';
}

export function PaymentDisputeEmail(props: PaymentDisputeEmailProps) {
  const opened = props.kind === 'opened';
  return (
    <Html>
      <Head />
      <Preview>{paymentDisputeSubject(props)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{PLATFORM_NAME}</Text>
          <Section style={card}>
            <Text style={heading}>{opened ? 'A customer’s bank opened a chargeback' : 'A chargeback is settled'}</Text>
            {opened ? (
              <>
                <Text style={paragraph}>
                  The bank of the customer who paid for order <strong>{props.reference}</strong> at {props.storeName}{' '}
                  has disputed the payment of <strong>{props.amount}</strong>.
                </Text>
                <Text style={paragraph}>
                  {props.dueDate ? `A response is due by ${props.dueDate}. ` : ''}
                  Gather what shows the order was delivered — the courier’s confirmation, a signature, messages with the
                  customer. Our team will be in touch about sending it to Paystack.
                </Text>
              </>
            ) : (
              <Text style={paragraph}>
                The chargeback on order <strong>{props.reference}</strong> ({props.amount}) at {props.storeName} is
                settled. {outcomeLine(props.resolution)}
              </Text>
            )}
            <Button style={button} href={props.orderUrl}>
              Open the order
            </Button>
            <Hr style={hr} />
            <Text style={footer}>You’re receiving this because you handle orders for {props.storeName}.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default PaymentDisputeEmail;

const main: React.CSSProperties = {
  backgroundColor: '#f5f5f4',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { margin: '0 auto', padding: '40px 20px', maxWidth: '560px' };
const logo: React.CSSProperties = { fontSize: '18px', fontWeight: 700, color: '#1c1917', margin: '0 0 24px' };
const card: React.CSSProperties = { backgroundColor: '#ffffff', borderRadius: '8px', padding: '32px', border: '1px solid #e7e5e4' };
const heading: React.CSSProperties = { fontSize: '20px', fontWeight: 600, color: '#1c1917', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '14px', lineHeight: '22px', color: '#44403c', margin: '0 0 16px' };
const button: React.CSSProperties = {
  backgroundColor: '#1c1917',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '10px 20px',
  display: 'inline-block',
};
const hr: React.CSSProperties = { borderColor: '#e7e5e4', margin: '24px 0' };
const footer: React.CSSProperties = { fontSize: '12px', color: '#a8a29e', margin: 0 };
