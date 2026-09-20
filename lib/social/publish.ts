/*
 * lib/social/publish.ts
 *
 * Turning a composer submission into a real post, or an honest failure.
 *
 * THE TENANT RULE, again and in one more place: every id that arrives from
 * the browser — the connection, the product, the images — is resolved
 * together with the organizationId from the session. A connection belonging
 * to another store is not found. A product belonging to another store is not
 * found. An image id that isn't on that product is dropped. There is no path
 * through this file where a client-supplied id widens what a merchant can
 * reach.
 *
 * WHAT "PUBLISHED" MEANS HERE: only that the platform returned an id. A
 * provider that throws leaves the row FAILED with the reason attached, and
 * the merchant can retry the same row. Nothing is ever marked published
 * optimistically.
 *
 * DOUBLE-CLICK: the row moves into PUBLISHING with a conditional update that
 * names the states it may move FROM. Two concurrent submissions both try; one
 * changes a row, the other changes nothing and stops. The unique
 * (organizationId, idempotencyKey) index means a retried server action lands
 * on the same row rather than creating a second one.
 *
 * Tokens are opened here, for the length of one call, and never written to
 * the post row — SocialPost has no token column.
 */
import { prisma } from '@/lib/prisma';
import { open } from './crypto';
import { getProviderForPlatform } from './registry';
import { getProductFacts, resolveImageUrls } from './product-facts';
import {
  SocialProviderError,
  type PublishRules,
  type SocialPlatform,
  type SocialPostRow,
  type SocialPostStatus,
} from './types';

/* ─── Reading history ───────────────────────────────────────────────────── */

/** Why the last attempt failed, in words a shop owner can act on. */
function problemFor(status: SocialPostStatus, code: string | null, message: string | null): string | null {
  if (status !== 'FAILED') return null;

  switch (code) {
    case 'token_invalid':
      return 'This account needs reconnecting before it can post again.';
    case 'permission_missing':
      return 'We don’t have permission to post to this account. Reconnect it and allow posting.';
    case 'rate_limited':
      return 'The platform is limiting posts right now. Try again in a few minutes.';
    case 'denied':
      return message ?? 'The platform wouldn’t accept this post.';
    default:
      return 'We couldn’t reach the platform. Try again in a moment.';
  }
}

type PostRecord = {
  id: string;
  platform: SocialPlatform;
  accountName: string;
  status: SocialPostStatus;
  productName: string | null;
  productUrl: string | null;
  caption: string;
  hashtags: string[];
  imageUrls: string[];
  externalUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: Date;
  publishedAt: Date | null;
};

/** Field set for every read. No token column exists on this table at all. */
const POST_FIELDS = {
  id: true,
  platform: true,
  accountName: true,
  status: true,
  productName: true,
  productUrl: true,
  caption: true,
  hashtags: true,
  imageUrls: true,
  externalUrl: true,
  errorCode: true,
  errorMessage: true,
  attempts: true,
  createdAt: true,
  publishedAt: true,
} as const;

function toRow(record: PostRecord): SocialPostRow {
  return {
    id: record.id,
    platform: record.platform,
    accountName: record.accountName,
    status: record.status,
    productName: record.productName,
    productUrl: record.productUrl,
    caption: record.caption,
    hashtags: record.hashtags,
    imageUrls: record.imageUrls,
    externalUrl: record.externalUrl,
    problem: problemFor(record.status, record.errorCode, record.errorMessage),
    attempts: record.attempts,
    createdAt: record.createdAt.toISOString(),
    publishedAt: record.publishedAt?.toISOString() ?? null,
  };
}

export async function listPosts(organizationId: string, limit = 100): Promise<SocialPostRow[]> {
  const rows = await prisma.socialPost.findMany({
    where: { organizationId },
    select: POST_FIELDS,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
  return rows.map(toRow);
}

/* ─── Composing ─────────────────────────────────────────────────────────── */

/** The caption as it will actually appear, hashtags and link included. */
export function composeMessage(
  caption: string,
  hashtags: string[],
  productUrl: string | null,
  rules: PublishRules,
): string {
  const parts = [caption.trim()];

  /* The link goes in only where it's clickable. On Instagram a URL in a
   * caption is dead text, so we don't put one there and pretend otherwise. */
  if (productUrl && rules.supportsLinkInCaption) parts.push(productUrl);
  if (hashtags.length > 0) parts.push(hashtags.join(' '));

  return parts.filter(Boolean).join('\n\n').slice(0, rules.maxCaptionChars);
}

export interface PublishInput {
  connectionId: string;
  productId: string;
  /** ProductImage ids; narrowed to the ones the product owns. */
  imageIds: string[];
  caption: string;
  hashtags: string[];
  /** One composer submission. Makes a double-click idempotent. */
  idempotencyKey: string;
}

export type PublishOutcome =
  | { ok: true; post: SocialPostRow }
  | { ok: false; reason: string; post: SocialPostRow | null };

/**
 * Publishes one post.
 *
 * `organizationId` and `userId` come from the session. Every other value in
 * `input` is treated as a claim to be checked against this store's rows.
 */
export async function publishPost(
  organizationId: string,
  userId: string,
  input: PublishInput,
): Promise<PublishOutcome> {
  /* An earlier submission with this key already made a row: this is a
   * double-click, a retried action, or a refresh. Return what happened the
   * first time rather than posting again. */
  const existing = await prisma.socialPost.findFirst({
    where: { organizationId, idempotencyKey: input.idempotencyKey },
    select: POST_FIELDS,
  });
  if (existing) {
    const row = toRow(existing);
    if (existing.status === 'PUBLISHED') return { ok: true, post: row };
    if (existing.status === 'PUBLISHING') {
      return { ok: false, reason: 'This post is already being published.', post: row };
    }
    // DRAFT or FAILED: fall through to retry that row.
    return retryPost(organizationId, existing.id);
  }

  // ── Ownership: the connection must be this store's, and usable ──────────
  const connection = await prisma.socialConnection.findFirst({
    where: { id: input.connectionId, organizationId },
    select: { id: true, platform: true, accountName: true, platformAccountId: true, accessTokenCipher: true, status: true },
  });
  if (!connection) {
    return { ok: false, reason: 'That account isn’t connected to this store', post: null };
  }
  if (connection.status !== 'ACTIVE' || !connection.accessTokenCipher) {
    return {
      ok: false,
      reason: `${connection.accountName} needs reconnecting before it can post`,
      post: null,
    };
  }

  // ── Ownership: the product must be this store's ─────────────────────────
  const facts = await getProductFacts(organizationId, input.productId);
  if (!facts) {
    return { ok: false, reason: 'That product isn’t in this store’s catalogue', post: null };
  }

  const provider = getProviderForPlatform(connection.platform);
  const rules = provider.publishRules(connection.platform);

  /* Images: only ones this product owns, capped at what the platform takes.
   * An id for another product's photo silently disappears here. */
  const imageUrls = resolveImageUrls(facts, input.imageIds).slice(0, rules.maxImages);

  if (rules.imagesRequired && imageUrls.length === 0) {
    return { ok: false, reason: 'Instagram posts need at least one image', post: null };
  }

  const caption = input.caption.trim();
  if (!caption) {
    return { ok: false, reason: 'Write a caption before publishing', post: null };
  }

  let postId: string;
  try {
    const created = await prisma.socialPost.create({
      data: {
        organizationId,
        connectionId: connection.id,
        platform: connection.platform,
        accountName: connection.accountName,
        inventoryItemId: facts.productId,
        productName: facts.name,
        productUrl: facts.productUrl,
        caption,
        hashtags: input.hashtags,
        imageUrls,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: userId,
        status: 'DRAFT',
      },
      select: { id: true },
    });
    postId = created.id;
  } catch (error) {
    /* Two clicks landed close enough together that both got past the read
     * above. The unique (organizationId, idempotencyKey) index is what
     * actually decides it: one insert wins, the other lands here. Recover by
     * using the row that won rather than surfacing a database error to a
     * merchant who simply clicked twice. */
    if (!isUniqueViolation(error)) throw error;

    const winner = await prisma.socialPost.findFirst({
      where: { organizationId, idempotencyKey: input.idempotencyKey },
      select: POST_FIELDS,
    });
    return {
      ok: false,
      reason: 'This post is already being published.',
      post: winner ? toRow(winner) : null,
    };
  }

  return sendToPlatform(organizationId, postId);
}

/**
 * Prisma's unique-constraint violation, duck-typed.
 *
 * Checked by code rather than by instanceof so this file doesn't have to
 * import Prisma's error classes — and so it keeps working if the client is
 * ever swapped or wrapped.
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/**
 * Retries a post that failed, or one that was left as a draft.
 *
 * Same tenancy rule and the same status guard as a first attempt — a retry
 * is not a way in around either.
 */
export async function retryPost(organizationId: string, postId: string): Promise<PublishOutcome> {
  const post = await prisma.socialPost.findFirst({
    where: { id: postId, organizationId },
    select: { id: true, status: true },
  });
  if (!post) return { ok: false, reason: 'That post isn’t in this store', post: null };

  if (post.status === 'PUBLISHED') {
    const row = await prisma.socialPost.findFirstOrThrow({ where: { id: postId, organizationId }, select: POST_FIELDS });
    return { ok: true, post: toRow(row) };
  }

  return sendToPlatform(organizationId, postId);
}

/**
 * The publish itself: claim the row, call the platform, record what happened.
 *
 * The claim is a conditional update — it only moves a row that is still
 * DRAFT or FAILED. Two callers race; exactly one gets count === 1, and the
 * other is told the post is already going out. That is the double-click
 * guard, and it lives in the database rather than in the browser.
 */
async function sendToPlatform(organizationId: string, postId: string): Promise<PublishOutcome> {
  const claimed = await prisma.socialPost.updateMany({
    where: { id: postId, organizationId, status: { in: ['DRAFT', 'FAILED'] } },
    data: { status: 'PUBLISHING', errorCode: null, errorMessage: null, attempts: { increment: 1 } },
  });

  if (claimed.count === 0) {
    const current = await prisma.socialPost.findFirst({ where: { id: postId, organizationId }, select: POST_FIELDS });
    return {
      ok: false,
      reason: current?.status === 'PUBLISHED' ? 'This post has already been published.' : 'This post is already being published.',
      post: current ? toRow(current) : null,
    };
  }

  const post = await prisma.socialPost.findFirstOrThrow({
    where: { id: postId, organizationId },
    select: {
      id: true,
      connectionId: true,
      platform: true,
      caption: true,
      hashtags: true,
      imageUrls: true,
      productUrl: true,
      connection: {
        select: { platformAccountId: true, accessTokenCipher: true, status: true, accountName: true },
      },
    },
  });

  const fail = async (code: string, message: string, reason: string): Promise<PublishOutcome> => {
    const updated = await prisma.socialPost.update({
      where: { id: postId },
      data: { status: 'FAILED', errorCode: code, errorMessage: message.slice(0, 500) },
      select: POST_FIELDS,
    });
    return { ok: false, reason, post: toRow(updated) };
  };

  /* The connection may have been disconnected between composing and
   * publishing. Its token is blanked on disconnect, so there is nothing to
   * publish with — and nothing to pretend with either. */
  if (post.connection.status !== 'ACTIVE' || !post.connection.accessTokenCipher) {
    return fail('token_invalid', 'connection is no longer active', `${post.connection.accountName} needs reconnecting`);
  }

  const provider = getProviderForPlatform(post.platform);
  const rules = provider.publishRules(post.platform);
  const message = composeMessage(post.caption, post.hashtags, post.productUrl, rules);

  try {
    const result = await provider.publishPost({
      platform: post.platform,
      platformAccountId: post.connection.platformAccountId,
      accessToken: open(post.connection.accessTokenCipher),
      message,
      imageUrls: post.imageUrls,
      link: post.productUrl,
    });

    const published = await prisma.socialPost.update({
      where: { id: postId },
      data: {
        status: 'PUBLISHED',
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
        publishedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
      select: POST_FIELDS,
    });
    return { ok: true, post: toRow(published) };
  } catch (error) {
    if (error instanceof SocialProviderError) {
      /* A token the platform rejected is a fact about the connection, not
       * just about this post — record it so the accounts list stops claiming
       * the account works. */
      if (error.kind === 'token_invalid') {
        await prisma.socialConnection.updateMany({
          where: { id: post.connectionId, organizationId },
          data: { status: 'REVOKED', lastErrorCode: error.code ?? null, lastCheckedAt: new Date() },
        });
      }
      console.error('[social] publish failed:', error.kind, error.message);
      return fail(error.kind, error.message, problemFor('FAILED', error.kind, error.message) ?? 'Publishing failed');
    }

    console.error('[social] publish failed:', error);
    return fail('unavailable', error instanceof Error ? error.message : 'unknown error', 'We couldn’t reach the platform. Try again in a moment.');
  }
}

/**
 * Releases posts stuck in PUBLISHING.
 *
 * A server that dies mid-publish leaves a row claimed forever, and a
 * merchant with no way to retry it. Anything still PUBLISHING after a few
 * minutes is presumed lost and moved to FAILED so it can be retried by hand.
 * Called opportunistically when the history page loads — no cron, no queue.
 */
export async function releaseStalePublishing(organizationId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 5 * 60_000);
  try {
    await prisma.socialPost.updateMany({
      where: { organizationId, status: 'PUBLISHING', updatedAt: { lt: cutoff } },
      data: {
        status: 'FAILED',
        errorCode: 'unavailable',
        errorMessage: 'Publishing was interrupted before the platform answered.',
      },
    });
  } catch (error) {
    console.error('[social] releasing stale posts failed:', error);
  }
}
