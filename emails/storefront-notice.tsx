/*
 * A short message to a SHOPPER, in the merchant's name (ROADMAP 21.1): the
 * answer to their trade account request, for one. Like the password reset
 * (./storefront-reset-password.tsx) it never says the platform's name — a
 * customer of Ada's Store hears from Ada's Store.
 *
 * The words are built by the caller; this only lays them out.
 */
import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';

export type StorefrontNoticeEmailProps = {
  storeName: string;
  subject: string;
  preview: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  /** why they got it */
  footer: string;
};

export function StorefrontNoticeEmail({ storeName, preview, heading, paragraphs, button, footer }: StorefrontNoticeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{storeName}</Text>
          <Section style={card}>
            <Text style={heading_}>{heading}</Text>
            {paragraphs.map((p, i) => (
              <Text key={i} style={paragraph}>
                {p}
              </Text>
            ))}
            {button && (
              <Button style={buttonStyle} href={button.url}>
                {button.label}
              </Button>
            )}
            <Hr style={hr} />
            <Text style={footerStyle}>{footer}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default StorefrontNoticeEmail;

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

const heading_: React.CSSProperties = {
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

const buttonStyle: React.CSSProperties = {
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

const footerStyle: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: '20px',
  color: '#6b7478',
  margin: '0 0 12px',
};
