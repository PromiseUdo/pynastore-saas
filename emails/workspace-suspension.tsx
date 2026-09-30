import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';
import { PLATFORM_NAME } from '@/lib/brand';

/*
 * A workspace suspended, or its suspension lifted, by platform staff
 * (ROADMAP 11.4). Sent to the workspace's owners. The reason is shown as
 * staff wrote it — it's the one thing the owner needs to act on.
 */
export type WorkspaceSuspensionEmailProps = {
  workspaceName: string;
  outcome: 'suspended' | 'restored';
  reason?: string | null;
  /** who to write to; omitted when none is configured */
  supportEmail?: string | null;
  /** the workspace's dashboard */
  adminUrl: string;
};

export function workspaceSuspensionSubject({ outcome, workspaceName }: WorkspaceSuspensionEmailProps): string {
  return outcome === 'suspended' ? `${workspaceName} has been suspended` : `${workspaceName} is open again`;
}

export function WorkspaceSuspensionEmail(props: WorkspaceSuspensionEmailProps) {
  const { workspaceName, outcome, reason, supportEmail, adminUrl } = props;
  const suspended = outcome === 'suspended';
  return (
    <Html>
      <Head />
      <Preview>{workspaceSuspensionSubject(props)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{PLATFORM_NAME}</Text>
          <Section style={card}>
            <Text style={heading}>{suspended ? 'Your workspace has been suspended' : 'Your workspace is open again'}</Text>
            {suspended ? (
              <>
                <Text style={paragraph}>
                  We’ve suspended <strong>{workspaceName}</strong> on {PLATFORM_NAME}. While it’s suspended, its dashboard
                  is closed and its shop is offline to customers.
                </Text>
                {reason && (
                  <>
                    <Text style={paragraph}>The reason:</Text>
                    <Text style={quote}>{reason}</Text>
                  </>
                )}
                <Text style={paragraph}>
                  Nothing has been deleted. Products, orders and customers are kept, and everything reopens as it was if
                  the suspension is lifted.
                </Text>
                {supportEmail && (
                  <Text style={paragraph}>
                    To talk to us about it, reply to {supportEmail}.
                  </Text>
                )}
              </>
            ) : (
              <>
                <Text style={paragraph}>
                  We’ve lifted the suspension on <strong>{workspaceName}</strong>. Its dashboard is open and its shop is
                  back online for customers.
                </Text>
                <Button style={button} href={adminUrl}>
                  Open your dashboard
                </Button>
              </>
            )}
            <Hr style={hr} />
            <Text style={footer}>
              You’re receiving this because you own {workspaceName} on {PLATFORM_NAME}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default WorkspaceSuspensionEmail;

const main: React.CSSProperties = {
  backgroundColor: '#f5f5f4',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { margin: '0 auto', padding: '40px 20px', maxWidth: '560px' };
const logo: React.CSSProperties = { fontSize: '18px', fontWeight: 700, color: '#1c1917', margin: '0 0 24px' };
const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  padding: '32px',
  border: '1px solid #e7e5e4',
};
const heading: React.CSSProperties = { fontSize: '20px', fontWeight: 600, color: '#1c1917', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '14px', lineHeight: '22px', color: '#44403c', margin: '0 0 16px' };
const quote: React.CSSProperties = {
  ...paragraph,
  borderLeft: '3px solid #d6d3d1',
  paddingLeft: '12px',
  color: '#1c1917',
  whiteSpace: 'pre-wrap',
};
const button: React.CSSProperties = {
  backgroundColor: '#1c1917',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '10px 20px',
  display: 'inline-block',
};
const hr: React.CSSProperties = { borderColor: '#e7e5e4', margin: '24px 0' };
const footer: React.CSSProperties = { fontSize: '12px', color: '#a8a29e', margin: 0 };
