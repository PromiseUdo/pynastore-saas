/*
 * POST /messages/feed — what the Messages page and the sidebar badge poll
 * (ROADMAP 17.2).
 *
 * A route handler, not a server action, on purpose: Next runs a page's
 * server actions one at a time, so a poll every few seconds through one
 * would hold up a reply behind it. It lives inside the dashboard segment
 * rather than under /api, so the proxy resolves the store from the hostname
 * and getOrganizationContext() works exactly as on a page — the store is
 * never something the browser says.
 *
 * Body (all optional):
 *   conversationId  the conversation on screen
 *   after           its newest message the browser holds → newer ones
 *   before          its oldest → the page before ("Load earlier")
 *   read            the newest message actually shown → marked read
 *   inbox           true when it's the Messages page asking, which tells the
 *                   unanswered-message email (17.4) someone is looking
 *
 * Always answers with the inbox summary (badge count, when anything last
 * changed); a screen that sees `changedAt` move refreshes its list.
 */
import { getOrganizationContext } from '@/lib/organization';
import { getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import {
  chatProductCards,
  inboxSummary,
  listStaffMessages,
  markReadByStaff,
  touchInboxSeen,
} from '@/lib/chat/service';
import { parseSeq } from '@/lib/chat/rules';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  /* JSON only: another site can't send that without a CORS preflight this
   * route never answers, so it can't mark a member's messages read for them. */
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return json({ error: 'Send JSON.' }, 415);
  }
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.MESSAGES_VIEW)) {
    return json({ error: 'You don’t have permission to see messages.' }, 403);
  }
  /* A workspace whose plan has ended keeps only billing and paid orders
   * open (ROADMAP 12.1); Messages isn't one of them. */
  if ((await getOrganizationEntitlements()).access.state === 'lapsed') {
    return json({ error: 'Your plan has ended.' }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    // An empty body is a summary-only poll.
  }

  const organizationId = ctx.organization.id;
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;

  if (body.inbox === true) await touchInboxSeen(organizationId);

  let conversation: Awaited<ReturnType<typeof listStaffMessages>> | undefined;
  if (conversationId) {
    /* Reading is shared across the team, so only someone who can reply marks
     * a conversation read — a view-only member looking must not clear it for
     * the person who has to answer. */
    const read = parseSeq(body.read);
    if (read !== undefined && hasPermission(perms, PERMISSIONS.MESSAGES_REPLY)) {
      await markReadByStaff(organizationId, conversationId, read);
    }
    const after = parseSeq(body.after);
    const before = parseSeq(body.before);
    conversation = await listStaffMessages(organizationId, conversationId, before !== undefined ? { before } : { after: after ?? 0 });
    if (!conversation) return json({ summary: await inboxSummary(organizationId), missing: true });
  }

  const [summary, products] = await Promise.all([
    inboxSummary(organizationId),
    conversation ? chatProductCards(organizationId, conversation.messages.map((m) => m.productId)) : {},
  ]);

  return json({
    summary,
    ...(conversation
      ? {
          messages: conversation.messages,
          hasEarlier: conversation.hasEarlier,
          lastSeq: conversation.lastSeq,
          products,
        }
      : {}),
  });
}
