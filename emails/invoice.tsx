/*
 * An invoice, sent in the merchant's name.
 *
 * Like the other customer-facing emails it never mentions the platform: the
 * customer is doing business with the merchant, not with us. The merchant's
 * logo heads it when they've uploaded one, their name when they haven't.
 *
 * Two shapes, one template. "Here is your invoice" and "this one is still
 * outstanding" differ by a sentence and a heading — sending them from two
 * templates would guarantee they drift apart.
 *
 * Every line restates something recorded against the invoice. It never says
 * a payment has been received, because only the merchant recording one makes
 * that true.
 */
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export type InvoiceEmailKind = 'issued' | 'reminder';

export type InvoiceEmailProps = {
  kind: InvoiceEmailKind;
  businessName: string;
  businessLogoUrl?: string | null;
  customerName: string;
  invoiceNumber: string;
  invoiceUrl: string;
  /** already formatted, e.g. "₦125,000.00" */
  total: string;
  /** what is left to pay, formatted — differs from the total once part-paid */
  outstanding: string;
  /** e.g. "14 May 2026"; absent when the merchant set no due date */
  dueDate?: string | null;
  /** set only when the due date has passed */
  daysOverdue?: number | null;
  lines: { name: string; quantity: number; total: string }[];
  /** where to send the money, if the merchant has published an account */
  bankAccounts?: { bankName: string; accountName: string; accountNumber: string }[];
  notes?: string | null;
};

function heading(props: InvoiceEmailProps): string {
  if (props.kind === 'reminder') {
    return props.daysOverdue && props.daysOverdue > 0 ? 'A reminder about your invoice' : 'Your invoice is due soon';
  }
  return `Invoice ${props.invoiceNumber}`;
}

function body(props: InvoiceEmailProps): string[] {
  const due = props.dueDate ? ` It’s due on ${props.dueDate}.` : '';

  if (props.kind === 'reminder') {
    const overdue =
      props.daysOverdue && props.daysOverdue > 0
        ? `This invoice was due on ${props.dueDate} — ${props.daysOverdue} ${
            props.daysOverdue === 1 ? 'day' : 'days'
          } ago.`
        : `This invoice is due on ${props.dueDate}.`;
    return [
      overdue,
      `There’s ${props.outstanding} left to pay. If you’ve already sent it, thank you — please ignore this.`,
    ];
  }

  return [
    `${props.businessName} has sent you invoice ${props.invoiceNumber} for ${props.total}.${due}`,
    'Everything on it is listed below. You can open your copy at any time with the link underneath.',
  ];
}

export function InvoiceEmail(props: InvoiceEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {heading(props)} — {props.outstanding} from {props.businessName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {props.businessLogoUrl ? (
            <Img src={props.businessLogoUrl} alt={props.businessName} height={40} style={logoImage} />
          ) : (
            <Text style={logo}>{props.businessName}</Text>
          )}

          <Section style={card}>
            <Text style={headingStyle}>{heading(props)}</Text>
            {props.customerName && <Text style={paragraph}>Hi {props.customerName},</Text>}
            {body(props).map((sentence) => (
              <Text key={sentence} style={paragraph}>
                {sentence}
              </Text>
            ))}

            <Text style={reference}>Invoice {props.invoiceNumber}</Text>

            <Hr style={hr} />

            {props.lines.map((line, index) => (
              <table key={`${line.name}-${index}`} width="100%" cellPadding={0} cellSpacing={0} style={row}>
                <tbody>
                  <tr>
                    <td style={lineName}>
                      {line.name} × {line.quantity}
                    </td>
                    <td style={lineTotal}>{line.total}</td>
                  </tr>
                </tbody>
              </table>
            ))}

            <table width="100%" cellPadding={0} cellSpacing={0} style={row}>
              <tbody>
                <tr>
                  <td style={totalLabel}>Total</td>
                  <td style={totalValue}>{props.total}</td>
                </tr>
                {/* Only worth a line of its own once it differs from the total. */}
                {props.outstanding !== props.total && (
                  <tr>
                    <td style={totalLabel}>Still to pay</td>
                    <td style={totalValue}>{props.outstanding}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {props.bankAccounts && props.bankAccounts.length > 0 && (
              <>
                <Hr style={hr} />
                {props.bankAccounts.map((account, index) => (
                  <Section key={`${account.accountNumber}-${index}`} style={transferBox}>
                    <Text style={label}>Pay into</Text>
                    <Text style={addressLine}>{account.bankName}</Text>
                    <Text style={addressLine}>{account.accountName}</Text>
                    <Text style={accountNumber}>{account.accountNumber}</Text>
                    <Text style={label}>Amount · reference</Text>
                    <Text style={addressLine}>
                      {props.outstanding} · {props.invoiceNumber}
                    </Text>
                  </Section>
                ))}
              </>
            )}

            {props.notes && (
              <>
                <Hr style={hr} />
                <Text style={paragraph}>{props.notes}</Text>
              </>
            )}

            <Button style={button} href={props.invoiceUrl}>
              View your invoice
            </Button>

            <Text style={footer}>
              Quote invoice {props.invoiceNumber} if you get in touch with {props.businessName}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default InvoiceEmail;

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const main: React.CSSProperties = {
  backgroundColor: '#f4f5f7',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '40px 20px' };
const logo: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: '700',
  color: '#101828',
  textAlign: 'center',
  marginBottom: '32px',
};
const logoImage: React.CSSProperties = { display: 'block', margin: '0 auto 32px' };
const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  border: '1px solid #e4e7ec',
  padding: '32px',
};
const headingStyle: React.CSSProperties = { fontSize: '22px', fontWeight: '600', color: '#101828', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#475467', margin: '0 0 12px' };
const reference: React.CSSProperties = { fontSize: '14px', fontWeight: '600', color: '#101828', margin: '8px 0 0' };
const hr: React.CSSProperties = { borderColor: '#e4e7ec', margin: '20px 0' };
const row: React.CSSProperties = { marginBottom: '6px' };
const lineName: React.CSSProperties = { fontSize: '14px', color: '#475467' };
const lineTotal: React.CSSProperties = { fontSize: '14px', color: '#101828', textAlign: 'right' };
const totalLabel: React.CSSProperties = { fontSize: '15px', fontWeight: '600', color: '#101828', paddingTop: '10px' };
const totalValue: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: '600',
  color: '#101828',
  textAlign: 'right',
  paddingTop: '10px',
};
const transferBox: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  border: '1px solid #e4e7ec',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '8px',
};
const label: React.CSSProperties = {
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#667085',
  margin: '0 0 4px',
};
const addressLine: React.CSSProperties = { fontSize: '14px', color: '#101828', margin: '0 0 2px' };
const accountNumber: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: '700',
  letterSpacing: '0.04em',
  color: '#101828',
  margin: '0 0 12px',
};
const button: React.CSSProperties = {
  backgroundColor: '#101828',
  borderRadius: '8px',
  color: '#ffffff',
  display: 'block',
  fontSize: '15px',
  fontWeight: '600',
  padding: '12px 20px',
  textAlign: 'center',
  textDecoration: 'none',
  marginTop: '24px',
};
const footer: React.CSSProperties = { fontSize: '13px', color: '#667085', margin: '20px 0 0', textAlign: 'center' };
