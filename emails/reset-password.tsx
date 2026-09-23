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
import { PLATFORM_NAME } from '@/lib/brand';

type ResetPasswordEmailProps = {
  resetUrl: string;
  expiresInMinutes: number;
};

export function ResetPasswordEmail({
  resetUrl,
  expiresInMinutes,
}: ResetPasswordEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your {PLATFORM_NAME} password</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{PLATFORM_NAME}</Text>

          <Section style={card}>
            <Text style={heading}>Reset your password</Text>

            <Text style={paragraph}>
              We received a request to reset the password for your {PLATFORM_NAME}
              account. Click the button below to choose a new password.
            </Text>

            <Text style={paragraph}>
              This link expires in {expiresInMinutes} minutes.
            </Text>

            <Button style={button} href={resetUrl}>
              Reset password
            </Button>

            <Hr style={hr} />

            <Text style={footer}>
              If you didn&apos;t request a password reset, you can safely
              ignore this email — your password will not be changed. If
              you&apos;re concerned about your account&apos;s security,
              contact support.
            </Text>

            <Text style={urlText}>
              Or copy and paste this URL into your browser:{' '}
              <span style={urlSpan}>{resetUrl}</span>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default ResetPasswordEmail;

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const main: React.CSSProperties = {
  backgroundColor: '#f5f5f4',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const container: React.CSSProperties = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '40px 20px',
};

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

const heading: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: '600',
  color: '#18181b',
  margin: '0 0 16px',
};

const paragraph: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '24px',
  color: '#3f3f46',
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
  padding: '10px 20px',
  margin: '8px 0 24px',
};

const hr: React.CSSProperties = {
  borderColor: '#e4e4e7',
  margin: '24px 0 20px',
};

const footer: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: '20px',
  color: '#71717a',
  margin: '0 0 12px',
};

const urlText: React.CSSProperties = {
  fontSize: '12px',
  lineHeight: '18px',
  color: '#a1a1aa',
  wordBreak: 'break-all',
};

const urlSpan: React.CSSProperties = {
  color: '#3b82f6',
};
