/*
 * Password reset for a SHOPPER, sent in the merchant's name.
 *
 * Deliberately not the staff template (emails/reset-password.tsx): this one
 * never says "SafeBase". A customer of Ada's Store asked Ada's Store for a
 * new password, and an email from a platform they have never heard of reads
 * like phishing — which is exactly the reflex we want their real security
 * instincts to keep.
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

type StorefrontResetPasswordEmailProps = {
  storeName: string;
  resetUrl: string;
  expiresInMinutes: number;
};

export function StorefrontResetPasswordEmail({
  storeName,
  resetUrl,
  expiresInMinutes,
}: StorefrontResetPasswordEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your {storeName} password</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{storeName}</Text>

          <Section style={card}>
            <Text style={heading}>Reset your password</Text>

            <Text style={paragraph}>
              Someone asked to reset the password for your {storeName} account.
              Choose a new one using the button below.
            </Text>

            <Text style={paragraph}>This link works once, and expires in {expiresInMinutes} minutes.</Text>

            <Button style={button} href={resetUrl}>
              Choose a new password
            </Button>

            <Hr style={hr} />

            <Text style={footer}>
              If this wasn&apos;t you, you can ignore this email — your password stays as it is.
            </Text>

            <Text style={urlText}>
              Or paste this link into your browser: <span style={urlSpan}>{resetUrl}</span>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default StorefrontResetPasswordEmail;

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const main: React.CSSProperties = {
  backgroundColor: '#f6f2e2',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const container: React.CSSProperties = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '40px 20px',
};

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

const heading: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: '600',
  color: '#001822',
  margin: '0 0 16px',
};

const paragraph: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '24px',
  color: '#3f4a4f',
  margin: '0 0 16px',
};

const button: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#001822',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  borderRadius: '999px',
  padding: '12px 24px',
  margin: '8px 0 24px',
};

const hr: React.CSSProperties = {
  borderColor: '#e7e2cf',
  margin: '24px 0 20px',
};

const footer: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: '20px',
  color: '#6b7478',
  margin: '0 0 12px',
};

const urlText: React.CSSProperties = {
  fontSize: '12px',
  lineHeight: '18px',
  color: '#9aa1a4',
  wordBreak: 'break-all',
};

const urlSpan: React.CSSProperties = {
  color: '#114d59',
};
