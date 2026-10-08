/*
 * Telling a store's staff that a shopper is waiting for a reply in Messages
 * (ROADMAP 17.4).
 *
 * Sent once per unanswered conversation, and only when nobody at the store
 * had Messages open — so it says what the shopper wrote and gives the one
 * thing to do: open the conversation and reply.
 */
import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';

export type ChatMessageAlertEmailProps = {
  storeName: string;
  /** the customer's name, or a guest's chosen one; null for an unnamed guest */
  shopperName: string | null;
  isGuest: boolean;
  /** what they wrote, already shortened */
  message: string;
  /** the conversation in the admin */
  conversationUrl: string;
};

function who(props: Pick<ChatMessageAlertEmailProps, 'shopperName' | 'isGuest'>): string {
  if (props.shopperName) return props.isGuest ? `${props.shopperName} (a guest)` : props.shopperName;
  return 'A shopper';
}

export function chatMessageAlertSubject(props: Pick<ChatMessageAlertEmailProps, 'shopperName' | 'isGuest' | 'storeName'>) {
  return `${who(props)} sent ${props.storeName} a message`;
}

export function ChatMessageAlertEmail(props: ChatMessageAlertEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{chatMessageAlertSubject(props)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={logo}>{props.storeName}</Text>

          <Section style={card}>
            <Text style={heading}>A shopper is waiting for a reply</Text>
            <Text style={paragraph}>{who(props)} messaged your shop from your online store:</Text>
            <Text style={quote}>“{props.message}”</Text>
            <Text style={paragraph}>They’ll see your reply in the chat on your shop.</Text>

            <Button style={button} href={props.conversationUrl}>
              Reply in Messages
            </Button>

            <Hr style={hr} />

            <Text style={footer}>
              You’re receiving this because your role can reply to shoppers for {props.storeName}. We email once per
              unanswered conversation, and not while someone has Messages open.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default ChatMessageAlertEmail;

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const main: React.CSSProperties = {
  backgroundColor: '#f5f5f4',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '40px 20px' };
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
const heading: React.CSSProperties = { fontSize: '22px', fontWeight: '600', color: '#18181b', margin: '0 0 16px' };
const paragraph: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#3f3f46', margin: '0 0 16px' };
const quote: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#3f3f46',
  whiteSpace: 'pre-wrap',
  borderLeft: '3px solid #e4e4e7',
  padding: '4px 0 4px 12px',
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
const hr: React.CSSProperties = { borderColor: '#e4e4e7', margin: '24px 0' };
const footer: React.CSSProperties = { fontSize: '13px', lineHeight: '20px', color: '#71717a', margin: 0 };
