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

type DomainOrderNotificationEmailProps = {
  orgName: string;
  orgSlug: string;
  domainOrderType: 'EXISTING' | 'REGISTER';
  domain: string;
};

export function DomainOrderNotificationEmail({
  orgName,
  orgSlug,
  domainOrderType,
  domain,
}: DomainOrderNotificationEmailProps) {
  const actionLabel = domainOrderType === 'REGISTER' ? 'Register and connect' : 'Connect existing';

  return (
    <Html>
      <Head />
      <Preview>
        New domain order: {domain} for {orgName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>SafeBase</Text>

          <Section style={card}>
            <Text style={heading}>New domain order pending fulfillment</Text>

            <Text style={paragraph}>
              <strong>{orgName}</strong> ({orgSlug}) paid for a custom domain and is
              expecting it active within 24 hours.
            </Text>

            <Text style={paragraph}>
              Domain: <strong>{domain}</strong>
              <br />
              Type: <strong>{actionLabel}</strong>
            </Text>

            <Hr style={hr} />

            <Text style={footer}>
              Fulfill manually ({domainOrderType === 'REGISTER' ? 'register the domain and point DNS' : 'confirm DNS with the customer'}),
              then mark the DomainOrder as ACTIVE and set the org&apos;s
              customAdminDomain/customStoreDomain.
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
