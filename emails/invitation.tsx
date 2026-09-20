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

type InvitationEmailProps = {
  orgName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
};

export function InvitationEmail({
  orgName,
  inviterName,
  role,
  inviteUrl,
}: InvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {inviterName} invited you to join {orgName} as {role}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Wordmark */}
          <Text style={logo}>SafeBase</Text>

          <Section style={card}>
            <Text style={heading}>You have been invited</Text>

            <Text style={paragraph}>
              <strong>{inviterName}</strong> has invited you to join{' '}
              <strong>{orgName}</strong> as a <strong>{role}</strong>.
            </Text>

            <Text style={paragraph}>
              Click the button below to accept the invitation and set up your
              account. This invitation expires in 7 days.
            </Text>

            <Button style={button} href={inviteUrl}>
              Accept invitation
            </Button>

            <Hr style={hr} />

            <Text style={footer}>
              If you weren&apos;t expecting this invitation, you can ignore this
              email. If you have questions, contact your organization
              administrator.
            </Text>

            <Text style={urlText}>
              Or copy and paste this URL into your browser:{' '}
              <span style={urlSpan}>{inviteUrl}</span>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default InvitationEmail;

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
