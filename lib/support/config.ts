/*
 * lib/support/config.ts
 *
 * Website chat for visitors (ROADMAP 23): who to reach and when, and the
 * Freshchat web widget that carries the conversation. Server only — the
 * widget's two values are read from the environment and handed to the page,
 * so changing account is a setting, not a code change.
 *
 * The widget is loaded directly (`{host}/js/widget.js` + `fcWidget.init`),
 * NOT through the `fw-cdn.com` snippet Freshworks offers first: that snippet
 * is their whole marketing tracker (visitor tracking, conversion tools) with
 * the chat inside it, and we only want the chat.
 */
import { PLATFORM_SUPPORT_EMAIL } from '@/lib/brand';

export interface SupportChatConfig {
  /** e.g. https://pynacode-….freshchat.com — also what the CSP allows */
  host: string;
  /** the widget's public token (it is on every page that shows the chat) */
  token: string;
  /** the widget to show; unset = the account's default widget */
  widgetUuid: string | null;
}

/** The chat, or null when it isn't set up — then no button is shown. */
export function getSupportChatConfig(): SupportChatConfig | null {
  const host = process.env.FRESHCHAT_HOST?.trim().replace(/\/+$/, '');
  const token = process.env.FRESHCHAT_TOKEN?.trim();
  if (!host || !token) return null;
  // Only ever a Freshchat address: this value goes into the CSP and a <script src>.
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.freshchat\.com$/i.test(url.hostname)) return null;
  return { host: url.origin, token, widgetUuid: process.env.FRESHCHAT_WIDGET_UUID?.trim() || null };
}

/** The public pages the chat appears on — the platform host's, nothing behind a sign-in. */
export const SUPPORT_CHAT_PATHS = new Set(['/', '/pricing', '/privacy', '/terms']);

/**
 * The chat's fallback when it can't load. Support hours (Monday to Saturday,
 * 9 to 5, Lagos) and the away/offline form live in Freshchat itself.
 */
export const SUPPORT = { email: PLATFORM_SUPPORT_EMAIL } as const;
