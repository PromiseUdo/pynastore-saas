/*
 * Messages (ROADMAP 17.2).
 *
 * Private conversations with shoppers from the online store — not the public
 * product Q&A, which is Sales → Questions. The list and the open
 * conversation are rendered here on the server; after that the page polls
 * ./feed for new messages and refreshes itself when the inbox changes.
 *
 * Everything that picks what's shown lives in the URL: `view`, `q`, `page`
 * and `c` (the open conversation), so a refresh or a link to a colleague
 * lands on the same place.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import {
  chatProductCards,
  chatSetup,
  getConversationForStaff,
  listConversations,
  listStaffMessages,
} from '@/lib/chat/service';
import { CONVERSATION_PAGE_SIZE, parseInboxView } from '@/lib/chat/rules';
import { MessagesPageClient } from './_components/MessagesPageClient';

export const metadata: Metadata = { title: 'Messages' };

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string; c?: string }>;
}) {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.MESSAGES_VIEW)) return <AccessDenied what="messages from shoppers" />;

  const organizationId = ctx.organization.id;
  const params = await searchParams;
  const view = parseInboxView(params.view);
  const query = params.q?.trim() ?? '';
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const selectedId = params.c?.trim() || null;

  const may = {
    contact: hasPermission(perms, PERMISSIONS.CUSTOMER_VIEW),
    orders: hasPermission(perms, PERMISSIONS.SALES_VIEW),
  };

  const [list, setup, conversation, thread] = await Promise.all([
    listConversations(organizationId, { view, q: query, page }),
    chatSetup(organizationId),
    selectedId ? getConversationForStaff(organizationId, selectedId, may) : null,
    selectedId ? listStaffMessages(organizationId, selectedId) : null,
  ]);

  const products =
    conversation && thread
      ? await chatProductCards(organizationId, [...thread.messages.map((m) => m.productId), conversation.latestProductId])
      : {};

  return (
    <MessagesPageClient
      rows={list.rows}
      total={list.total}
      page={page}
      pageSize={CONVERSATION_PAGE_SIZE}
      view={view}
      query={query}
      selectedId={selectedId}
      selected={
        conversation && thread
          ? { conversation, messages: thread.messages, hasEarlier: thread.hasEarlier ?? false, products }
          : null
      }
      setup={setup}
      currency={ctx.organization.currency}
      can={{
        reply: hasPermission(perms, PERMISSIONS.MESSAGES_REPLY),
        viewCustomers: may.contact,
        viewOrders: may.orders,
        viewProducts: hasPermission(perms, PERMISSIONS.INVENTORY_VIEW),
        viewSettings: hasPermission(perms, PERMISSIONS.SETTINGS_VIEW),
      }}
    />
  );
}
