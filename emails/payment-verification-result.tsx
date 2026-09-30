import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';
import { PLATFORM_NAME } from '@/lib/brand';

/*
 * The result of our check of a merchant's business (ROADMAP 10.8 / 11.3).
 * Sent to the payments contact they gave. Approval says honestly that payouts
 * still need setting up — being approved is not the same as being able to
 * take payments yet.
 */
export type PaymentVerificationResultEmailProps = {
  businessName: string;
  outcome: 'approved' | 'rejected';
  /** shown as written — the merchant needs to know exactly what to fix */
  reason?: string | null;
  /** approved AND the Paystack subaccount is already active */
  payoutsReady?: boolean;
  /** Settings → Payments → Get paid online, on the merchant's admin host */
  setupUrl: string;
};

export function paymentVerificationSubject({ outcome, businessName }: PaymentVerificationResultEmailProps): string {
  return outcome === 'approved'
    ? `${businessName} is approved for online payments`
    : `We need a change to ${businessName}’s details`;
}

export function PaymentVerificationResultEmail({ businessName, outcome, reason, payoutsReady, setupUrl }: PaymentVerificationResultEmailProps) {
  const approved = outcome === 'approved';
  return (
    <Html>
      <Head />
      <Preview>{paymentVerificationSubject({ businessName, outcome, reason, setupUrl })}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{PLATFORM_NAME}</Text>

          <Section style={card}>
            <Text style={heading}>{approved ? 'Your business is approved' : 'Your details need a change'}</Text>

            {approved ? (
              <>
                <Text style={paragraph}>
                  We’ve checked the details you sent for <strong>{businessName}</strong>, and they’re approved.
                </Text>
                <Text style={paragraph}>
                  {payoutsReady
                    ? 'Payouts to the bank account you gave us are set up, so online payments settle straight to it, less Paystack’s fee.'
                    : 'Next we set up payouts to the bank account you gave us. Online payments switch on once that’s done — the page below shows where it stands.'}
                </Text>
              </>
            ) : (
              <>
                <Text style={paragraph}>
                  We couldn’t approve the details you sent for <strong>{businessName}</strong> yet. Here’s what our team
                  said:
                </Text>
                <Text style={quote}>{reason}</Text>
                <Text style={paragraph}>Change what’s needed and submit again. Everything else you entered is kept.</Text>
              </>
            )}

            <Button style={button} href={setupUrl}>
              {approved ? 'See your payment setup' : 'Review and resubmit'}
            </Button>

            <Hr style={hr} />

            <Text style={footer}>
              You’re receiving this because you’re the payments contact for {businessName} on {PLATFORM_NAME}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default PaymentVerificationResultEmail;

const main: React.CSSProperties = {
  backgroundColor: '#f5f5f4',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { margin: '0 auto', padding: '40px 20px', maxWidth: '560px' };
const logo: React.CSSProperties = { fontSize: '18px', fontWeight: 700, color: '#1c1917', margin: '0 0 24px' };
const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  padding: '32px',
  border: '1px solid #e7e5e4',
};
const heading: React.CSSProperties = { fontSize: '20px', fontWeight: 600, color: '#1c1917', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '14px', lineHeight: '22px', color: '#44403c', margin: '0 0 16px' };
const quote: React.CSSProperties = {
  ...paragraph,
  borderLeft: '3px solid #d6d3d1',
  paddingLeft: '12px',
  color: '#1c1917',
  whiteSpace: 'pre-wrap',
};
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
