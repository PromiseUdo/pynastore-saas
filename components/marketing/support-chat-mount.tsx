/*
 * The website chat on a public page (ROADMAP 23), when it's set up. Server
 * component: reads the settings and hands the client only what it needs.
 */
import { getSupportChatConfig, SUPPORT } from '@/lib/support/config';
import { SupportChat } from './support-chat';

export function SupportChatMount() {
  const config = getSupportChatConfig();
  if (!config) return null;
  return <SupportChat host={config.host} token={config.token} widgetUuid={config.widgetUuid} email={SUPPORT.email} />;
}

/** Whether pages should offer "Chat with us" links. */
export function supportChatOn(): boolean {
  return getSupportChatConfig() !== null;
}
