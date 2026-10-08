/*
 * /chat — the shop's chat, as a page (ROADMAP 17.4).
 *
 * Where a "The store replied" notification lands inside the store's own app
 * (lib/chat/alerts.ts sends `/s/{slug}/chat`), and a link a shop can share.
 * It opens the chat panel; behind it, the way back to the shop. When the
 * shop doesn't take messages it says so, rather than opening nothing.
 */
import type { Metadata } from 'next';
import { ChatPageOpener } from '@/components/storefront/chat/chat-page-opener';

export const metadata: Metadata = { title: 'Messages', robots: { index: false, follow: false } };

export default function ChatPage() {
  return (
    <div className="sf-container py-10">
      <div className="mx-auto max-w-xl">
        <ChatPageOpener />
      </div>
    </div>
  );
}
