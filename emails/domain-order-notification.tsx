import {
  Body,
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

type DomainOrderNotificationEmailProps = {
  orgName: string;
  orgSlug: string;
  domainOrderType: 'EXISTING' | 'REGISTER' | 'RENEW';
  /** the order in the console's queue */
  queueUrl?: string;
  domain: string;
};

export function DomainOrderNotificationEmail({
  orgName,
  orgSlug,
  domainOrderType,
  domain,
  queueUrl,
}: DomainOrderNotificationEmailProps) {
  const actionLabel =
    domainOrderType === 'REGISTER' ? 'Register and connect' : domainOrderType === 'RENEW' ? 'Renew at Namecheap' : 'Connect their own domain';

  return (
    <Html>
      <Head />
      <Preview>
        New domain order: {domain} for {orgName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{PLATFORM_NAME}</Text>

          <Section style={card}>
            <Text style={heading}>Domain work waiting</Text>

            <Text style={paragraph}>
              <strong>{orgName}</strong> ({orgSlug}) is expecting this done within 24 hours.
            </Text>

            <Text style={paragraph}>
              Domain: <strong>{domain}</strong>
              <br />
              Type: <strong>{actionLabel}</strong>
            </Text>

            <Hr style={hr} />

            <Text style={footer}>
              Work through its checklist in the platform console{queueUrl ? `: ${queueUrl}` : ' (Domains)'}, then mark it live
              there — that routes the shop and emails the merchant.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default DomainOrderNotificationEmail;

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

const hr: React.CSSProperties = {
  borderColor: '#e4e4e7',
  margin: '24px 0',
};

const footer: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: '20px',
  color: '#71717a',
  margin: 0,
};
