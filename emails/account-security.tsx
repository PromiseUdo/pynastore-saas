/*
 * A change to someone's own sign-in (ROADMAP 14.5): the password changed,
 * two-step sign-in turned on or off, their email being moved, or a link to
 * confirm a new email. Sent straight away and never optional — the one
 * warning a person gets if someone else is in their account, so it always
 * says what to do if it wasn't them.
 */
import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';
import { PLATFORM_NAME } from '@/lib/brand';

export type AccountSecurityEmailProps = {
  heading: string;
  paragraphs: string[];
  /** a button: what to do next */
  action?: { label: string; url: string };
  /** said under a rule: "If this wasn't you…" — omitted for a confirmation link */
  notYou?: string;
};

export function AccountSecurityEmail({ heading, paragraphs, action, notYou }: AccountSecurityEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{heading}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{PLATFORM_NAME}</Text>
          <Section style={card}>
            <Text style={headingStyle}>{heading}</Text>
            {paragraphs.map((text) => (
              <Text key={text} style={paragraph}>
                {text}
              </Text>
            ))}
            {action && (
              <Button style={button} href={action.url}>
                {action.label}
              </Button>
            )}
            {notYou && (
              <>
                <Hr style={hr} />
                <Text style={footer}>{notYou}</Text>
              </>
            )}
            {action && (
              <Text style={urlText}>
                Or copy and paste this URL into your browser: <span style={urlSpan}>{action.url}</span>
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default AccountSecurityEmail;

const main: React.CSSProperties = {
  backgroundColor: '#f5f5f4',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '40px 20px' };
const logo: React.CSSProperties = { fontSize: '20px', fontWeight: '700', color: '#18181b', textAlign: 'center', marginBottom: '32px' };
const card: React.CSSProperties = { backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e4e4e7', padding: '32px' };
const headingStyle: React.CSSProperties = { fontSize: '22px', fontWeight: '600', color: '#18181b', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#3f3f46', margin: '0 0 16px' };
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
const hr: React.CSSProperties = { borderColor: '#e4e4e7', margin: '24px 0 20px' };
const footer: React.CSSProperties = { fontSize: '13px', lineHeight: '20px', color: '#71717a', margin: '0 0 12px' };
const urlText: React.CSSProperties = { fontSize: '12px', lineHeight: '18px', color: '#a1a1aa', wordBreak: 'break-all' };
const urlSpan: React.CSSProperties = { color: '#71717a' };
