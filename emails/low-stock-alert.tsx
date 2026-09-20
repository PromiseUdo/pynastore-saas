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

type LowStockAlertEmailProps = {
  itemName: string;
  sku: string;
  warehouseName: string;
  quantity: number;
  reorderPoint: number;
  inventoryUrl: string;
};

export function LowStockAlertEmail({
  itemName,
  sku,
  warehouseName,
  quantity,
  reorderPoint,
  inventoryUrl,
}: LowStockAlertEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {itemName} is low on stock at {warehouseName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>SafeBase</Text>

          <Section style={card}>
            <Text style={heading}>Low stock alert</Text>

            <Text style={paragraph}>
              <strong>{itemName}</strong> ({sku}) at <strong>{warehouseName}</strong>{' '}
              has dropped to {quantity}, at or below its reorder point of{' '}
              {reorderPoint}.
            </Text>

            <Button style={button} href={inventoryUrl}>
              View inventory
            </Button>

            <Hr style={hr} />

            <Text style={footer}>
              You&apos;re receiving this because your role manages inventory
              for this organization.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default LowStockAlertEmail;

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
  padding: '12px 24px',
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
