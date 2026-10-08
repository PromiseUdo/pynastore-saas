'use server';

/*
 * features/messages/actions.ts
 *
 * The store's side of Messages (ROADMAP 17.2): replying, resolving,
 * reopening and blocking. The data rules live in lib/chat/service.ts; this
 * file adds who may do it (`messages.reply`) and the audit entry, from the
 * member's own session — the organization is never taken from the browser.
 *
 * Reading — the inbox list, a conversation, polling for new messages — is
 * done by the page (server render) and the feed route
 * (app/(dashboard)/[organizationSlug]/messages/feed/route.ts), not here:
 * Next runs a page's server actions one at a time, so a poll through one
 * would queue behind a reply.
 */
import { runAfter } from '@/lib/run-after';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import {
  sendStaffMessage,
  setConversationBlocked,
  setConversationResolved,
} from '@/lib/chat/service';
import type { StaffChatMessage } from '@/lib/chat/rules';
import { pushStoreReply } from '@/lib/chat/alerts';
import type { ActionResult } from '@/features/sales/shared';

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to reply to messages' };
  }
  console.error(`[messages] ${fallback}:`, error);
  return { success: false, error: fallback };
}

async function replyContext() {
  const ctx = await getOrganizationContext();
  requirePermission(ctx.membership.role.permissions, PERMISSIONS.MESSAGES_REPLY);
  return ctx;
}

/**
 * Send a reply. `clientId` comes from the browser so that pressing Send
 * twice, or retrying after a dropped connection, saves one message.
 */
export async function sendReply(input: {
  conversationId: string;
  clientId: string;
  body: string;
}): Promise<ActionResult<{ message: StaffChatMessage }>> {
  try {
    const ctx = await replyContext();
    const result = await sendStaffMessage(ctx.organization.id, {
      conversationId: input.conversationId,
      staffUserId: ctx.userId,
      clientId: input.clientId,
      body: input.body,
    });
    if (!result.ok) return { success: false, error: result.message };
    // Buzz the shopper's phone if they asked and aren't looking (ROADMAP 17.4), after the reply is saved.
    const { conversationId, message } = result;
    runAfter(() => pushStoreReply(ctx.organization.id, conversationId, message.seq));
    return { success: true, data: { message } };
  } catch (error) {
    return failure(error, 'Your reply wasn’t sent. Please try again.');
  }
}

type StatusAction = 'resolved' | 'reopened' | 'blocked' | 'unblocked';

const NOT_FOUND = 'That conversation no longer exists';

async function changeStatus(conversationId: string, action: StatusAction): Promise<ActionResult> {
  try {
    const ctx = await replyContext();
    const organizationId = ctx.organization.id;
    const changed =
      action === 'resolved' || action === 'reopened'
        ? await setConversationResolved(organizationId, conversationId, ctx.userId, action === 'resolved')
        : await setConversationBlocked(organizationId, conversationId, ctx.userId, action === 'blocked');
    if (!changed) return { success: false, error: NOT_FOUND };

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: `messages.conversation.${action}`,
      entityType: 'ChatConversation',
      entityId: conversationId,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'That didn’t work. Please try again.');
  }
}

export async function resolveConversation(conversationId: string): Promise<ActionResult> {
  return changeStatus(conversationId, 'resolved');
}

export async function reopenConversation(conversationId: string): Promise<ActionResult> {
  return changeStatus(conversationId, 'reopened');
}

/** The shopper can't send any more; their history stays. */
export async function blockConversation(conversationId: string): Promise<ActionResult> {
  return changeStatus(conversationId, 'blocked');
}

export async function unblockConversation(conversationId: string): Promise<ActionResult> {
  return changeStatus(conversationId, 'unblocked');
}
