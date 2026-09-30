import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';
import { PLATFORM_NAME } from '@/lib/brand';

/*
 * One layout for the platform's short account emails — verifying an address,
 * the welcome, setup and trial reminders (ROADMAP 12.5). The words are built
 * in lib/onboarding/emails.ts; this only lays them out, so every such email
 * looks the same.
 */
export type PlatformNoticeEmailProps = {
  preview: string;
  heading: string;
  paragraphs: string[];
  /** a short checklist, e.g. the setup steps left */
  list?: string[];
  button?: { label: string; url: string };
  /** why they got it */
  footer: string;
  /** printed under the button, for mail apps that hide buttons */
  showUrl?: boolean;
};

export function PlatformNoticeEmail({ preview, heading, paragraphs, list, button, footer, showUrl }: PlatformNoticeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{PLATFORM_NAME}</Text>
          <Section style={card}>
            <Text style={headingStyle}>{heading}</Text>
            {paragraphs.map((p, i) => (
              <Text key={i} style={paragraph}>
                {p}
              </Text>
            ))}
            {list && list.length > 0 && (
              <ul style={ul}>
                {list.map((item) => (
                  <li key={item} style={li}>
                    {item}
                  </li>
                ))}
              </ul>
            )}
            {button && (
              <Button style={buttonStyle} href={button.url}>
                {button.label}
              </Button>
            )}
            {button && showUrl && (
              <Text style={urlText}>
                Or open this address: <span style={urlSpan}>{button.url}</span>
              </Text>
            )}
            <Hr style={hr} />
            <Text style={footerStyle}>{footer}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default PlatformNoticeEmail;

const main: React.CSSProperties = {
  backgroundColor: '#f5f5f4',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { margin: '0 auto', padding: '40px 20px', maxWidth: '560px' };
const logo: React.CSSProperties = { fontSize: '18px', fontWeight: 700, color: '#1c1917', margin: '0 0 24px' };
const card: React.CSSProperties = { backgroundColor: '#ffffff', borderRadius: '8px', padding: '32px', border: '1px solid #e7e5e4' };
const headingStyle: React.CSSProperties = { fontSize: '20px', fontWeight: 600, color: '#1c1917', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '14px', lineHeight: '22px', color: '#44403c', margin: '0 0 16px' };
const ul: React.CSSProperties = { margin: '0 0 20px', paddingLeft: '20px' };
const li: React.CSSProperties = { fontSize: '14px', lineHeight: '22px', color: '#1c1917' };
const buttonStyle: React.CSSProperties = {
  backgroundColor: '#1c1917',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '10px 20px',
  display: 'inline-block',
};
const urlText: React.CSSProperties = { fontSize: '12px', color: '#78716c', margin: '16px 0 0', wordBreak: 'break-all' };
const urlSpan: React.CSSProperties = { color: '#44403c' };
const hr: React.CSSProperties = { borderColor: '#e7e5e4', margin: '24px 0' };
const footerStyle: React.CSSProperties = { fontSize: '12px', color: '#a8a29e', margin: 0 };
