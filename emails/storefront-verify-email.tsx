/*
 * "Your code" — the six digits that prove a shopper owns their email
 * (ROADMAP 20.1).
 *
 * Sent in the merchant's name, like every other shopper email. The code is
 * the whole message: big, spaced, copyable, and in the subject too so it
 * shows on a phone's lock screen. It says what happens if it's ignored,
 * because the usual reason a stranger gets this is a mistyped address.
 */
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';

type Props = {
  storeName: string;
  code: string;
  expiresInMinutes: number;
};

export function StorefrontVerifyEmail({ storeName, code, expiresInMinutes }: Props) {
  return (
    <Html>
      <Head />
      <Preview>
        {code} is your {storeName} code
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{storeName}</Text>

          <Section style={card}>
            <Text style={heading}>Confirm your email</Text>

            <Text style={paragraph}>
              Enter this code on {storeName} to finish setting up your account.
            </Text>

            <Text style={codeStyle}>{code}</Text>

            <Text style={paragraph}>It works once, and expires in {expiresInMinutes} minutes.</Text>

            <Hr style={hr} />

            <Text style={footer}>
              If you didn&apos;t create an account at {storeName}, ignore this email. Without this
              code, nobody can use the account with your address.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default StorefrontVerifyEmail;

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
const codeStyle: React.CSSProperties = {
  fontSize: '34px', fontWeight: '700', letterSpacing: '8px', color: '#001822', textAlign: 'center',
  backgroundColor: '#f6f2e2', borderRadius: '12px', padding: '16px 0', margin: '8px 0 24px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};
const hr: React.CSSProperties = { borderColor: '#e7e2cf', margin: '24px 0 20px' };
const footer: React.CSSProperties = { fontSize: '13px', lineHeight: '20px', color: '#6b7478', margin: '0' };
