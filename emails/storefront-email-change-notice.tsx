/*
 * "Your email is being changed" — sent to the OLD address at REQUEST time.
 *
 * This is the only warning an account holder gets if somebody else is moving
 * their address, so it goes out before anything changes, not after. It names
 * the new address in full (it is their own account) and gives them one
 * concrete thing to do: change the password, which retires every session and
 * makes the pending link worthless.
 */
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

type Props = {
  storeName: string;
  newEmail: string;
  resetUrl: string;
};

export function StorefrontEmailChangeNoticeEmail({ storeName, newEmail, resetUrl }: Props) {
  return (
    <Html>
      <Head />
      <Preview>Someone asked to change the email on your {storeName} account</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{storeName}</Text>

          <Section style={card}>
            <Text style={heading}>Your email is being changed</Text>

            <Text style={paragraph}>
              Someone asked to move your {storeName} account to <strong>{newEmail}</strong>. It
              won&apos;t change until that address is confirmed.
            </Text>

            <Text style={paragraph}>
              If that was you, there&apos;s nothing to do here — just open the link we sent to the
              new address.
            </Text>

            <Hr style={hr} />

            <Text style={paragraph}>
              <strong>If it wasn&apos;t you</strong>, someone knows your password. Change it now:
              that signs them out everywhere and cancels the pending change.
            </Text>

            <Button style={button} href={resetUrl}>
              Change my password
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default StorefrontEmailChangeNoticeEmail;

const main: React.CSSProperties = {
  backgroundColor: '#f6f2e2',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '40px 20px' };
const logo: React.CSSProperties = {
  fontSize: '20px', fontWeight: '700', color: '#001822', textAlign: 'center', marginBottom: '32px',
};
const card: React.CSSProperties = {
  backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e7e2cf', padding: '32px',
};
const heading: React.CSSProperties = { fontSize: '22px', fontWeight: '600', color: '#001822', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#3f4a4f', margin: '0 0 16px' };
const button: React.CSSProperties = {
  display: 'inline-block', backgroundColor: '#001822', color: '#ffffff', fontSize: '15px',
  fontWeight: '600', textDecoration: 'none', borderRadius: '999px', padding: '12px 24px', margin: '8px 0 8px',
};
const hr: React.CSSProperties = { borderColor: '#e7e2cf', margin: '24px 0 20px' };
