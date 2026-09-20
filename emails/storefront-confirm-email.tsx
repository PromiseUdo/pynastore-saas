/*
 * "Confirm your new email" — sent to the NEW address when a shopper asks to
 * move the address on their account.
 *
 * Sent in the merchant's name, like every other shopper email. It says which
 * store, which address, and what happens if the link is ignored — because
 * the most common reason this message arrives is that somebody mistyped
 * their own address and a stranger got it.
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

type Props = {
  storeName: string;
  confirmUrl: string;
  expiresInMinutes: number;
};

export function StorefrontConfirmEmailChangeEmail({ storeName, confirmUrl, expiresInMinutes }: Props) {
  return (
    <Html>
      <Head />
      <Preview>Confirm this email for your {storeName} account</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{storeName}</Text>

          <Section style={card}>
            <Text style={heading}>Confirm your new email</Text>

            <Text style={paragraph}>
              Someone asked to use this address for their {storeName} account. Confirm it and it
              becomes the address you sign in with and where order updates go.
            </Text>

            <Text style={paragraph}>This link works once, and expires in {expiresInMinutes} minutes.</Text>

            <Button style={button} href={confirmUrl}>
              Confirm this email
            </Button>

            <Hr style={hr} />

            <Text style={footer}>
              If this wasn&apos;t you, ignore this email. Nothing changes until the link is opened,
              and the account keeps the address it has now.
            </Text>

            <Text style={urlText}>
              Or paste this link into your browser: <span style={urlSpan}>{confirmUrl}</span>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default StorefrontConfirmEmailChangeEmail;

const main: React.CSSProperties = {
  backgroundColor: '#f6f2e2',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '40px 20px' };
const logo: React.CSSProperties = {
  fontSize: '20px', fontWeight: '700', color: '#001822', textAlign: 'center', marginBottom: '32px',
};
const card: React.CSSProperties = {
  backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e7e2cf', padding: '32px',
};
const heading: React.CSSProperties = { fontSize: '22px', fontWeight: '600', color: '#001822', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#3f4a4f', margin: '0 0 16px' };
const button: React.CSSProperties = {
  display: 'inline-block', backgroundColor: '#001822', color: '#ffffff', fontSize: '15px',
  fontWeight: '600', textDecoration: 'none', borderRadius: '999px', padding: '12px 24px', margin: '8px 0 24px',
};
const hr: React.CSSProperties = { borderColor: '#e7e2cf', margin: '24px 0 20px' };
const footer: React.CSSProperties = { fontSize: '13px', lineHeight: '20px', color: '#6b7478', margin: '0 0 12px' };
const urlText: React.CSSProperties = { fontSize: '12px', lineHeight: '18px', color: '#9aa1a4', wordBreak: 'break-all' };
const urlSpan: React.CSSProperties = { color: '#114d59' };
