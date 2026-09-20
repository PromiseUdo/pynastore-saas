'use server';

/*
 * features/social/posts.ts
 *
 * The composer and the history, as the dashboard is allowed to use them.
 *
 * Every action here starts identically: resolve the org from the SESSION
 * (getOrganizationContext, which reads the hostname the proxy stamped —
 * never a field from a form), check the permission, then pass that
 * organizationId down. Connection ids, product ids and image ids arriving
 * from the browser are only ever used TOGETHER with it, so a merchant can
 * only ever address their own store's rows.
 *
 * Composing needs `social.manage` to post and `inventory.view` to browse the
 * catalogue — the product picker reuses features/inventory/products.ts
 * rather than growing a second, subtly different tenant-scoped product query.
 *
 * No action returns a token, and none accepts one.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { listProducts, type ProductListRow } from '@/features/inventory/products';
import { getProductFacts } from '@/lib/social/product-facts';
import { listPosts, publishPost, retryPost, releaseStalePublishing } from '@/lib/social/publish';
import { listConnections } from '@/lib/social/service';
import { getProviderForPlatform } from '@/lib/social/registry';
import {
  CopywriterError,
  generateCaption,
  generateHashtags,
  isRewriteTone,
  platformCopyStyle,
  rewriteCaption,
  type GeneratedCaption,
} from '@/lib/ai/social/copywriter';
import { checkCopyRequest } from '@/lib/ai/social/quota';
import type { PublishRules, SocialAccountRow, SocialPlatform, SocialPostRow } from '@/lib/social/types';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

/* ─── Errors ────────────────────────────────────────────────────────────── */

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to post to social accounts' };
  }
  console.error(`[social] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/** Copywriter failures, said the way a shop owner would understand them. */
function copyFailure(error: unknown): { success: false; error: string } {
  if (error instanceof CopywriterError) {
    console.error('[social] copywriter:', error.kind, error.message);
    switch (error.kind) {
      case 'not_configured':
        return { success: false, error: 'AI writing isn’t set up on this MansaaS installation yet' };
      case 'budget_exhausted':
      case 'rate_limited':
        return { success: false, error: 'We’ve hit today’s limit for AI writing. Try again shortly.' };
      case 'unusable_output':
        return {
          success: false,
          error: 'We couldn’t write something we could stand behind for this product. Add a description and try again.',
        };
      default:
        return { success: false, error: 'The AI writer is unavailable right now. Try again in a moment.' };
    }
  }
  return failure(error, 'We couldn’t write that');
}

/* ─── Composer data ─────────────────────────────────────────────────────── */

/** A destination the merchant can post to, with what that platform accepts. */
export interface PostDestination {
  connectionId: string;
  platform: SocialPlatform;
  accountName: string;
  username: string | null;
  rules: PublishRules;
  /** Null when it can be posted to; otherwise why it can't. */
  problem: string | null;
}

function toDestination(account: SocialAccountRow): PostDestination {
  const rules = getProviderForPlatform(account.platform).publishRules(account.platform);
  return {
    connectionId: account.id,
    platform: account.platform,
    accountName: account.accountName,
    username: account.username,
    rules,
    problem: account.status === 'ACTIVE' ? null : (account.problem ?? 'This account needs reconnecting'),
  };
}

export async function getPostDestinations(): Promise<ActionResult<PostDestination[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_VIEW);

    const accounts = await listConnections(ctx.organization.id);
    return { success: true, data: accounts.map(toDestination) };
  } catch (error) {
    return failure(error, 'We couldn’t load your connected accounts');
  }
}

/**
 * The product picker.
 *
 * Reuses the inventory list, which is already scoped to the session's
 * organization and gated on `inventory.view` — so there is exactly one
 * tenant-scoped product query in the app, not two.
 */
export async function searchPostProducts(query: string): Promise<ActionResult<ProductListRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);

    if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW)) {
      return { success: false, error: 'You need access to the catalogue to post a product' };
    }

    const result = await listProducts({ q: query.trim() || undefined, perPage: 20, sort: 'newest' });
    if (!result.success) return { success: false, error: result.error };

    return { success: true, data: result.data.rows };
  } catch (error) {
    return failure(error, 'We couldn’t search your products');
  }
}

/** What the composer shows once a product is chosen. Facts only, no ids to guess at. */
export interface PostProduct {
  productId: string;
  name: string;
  priceLabel: string | null;
  categoryPath: string[];
  brandName: string | null;
  /** Built server-side from the store's own domain — never supplied by the client. */
  productUrl: string | null;
  isPublished: boolean;
  images: { id: string; url: string; alt: string | null }[];
  /** True when there's little for the writer to work with. */
  thin: boolean;
}

export async function getPostProduct(productId: string): Promise<ActionResult<PostProduct>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);

    const facts = await getProductFacts(ctx.organization.id, productId);
    if (!facts) return { success: false, error: 'That product isn’t in this store’s catalogue' };

    return {
      success: true,
      data: {
        productId: facts.productId,
        name: facts.name,
        priceLabel: facts.priceLabel,
        categoryPath: facts.categoryPath,
        brandName: facts.brandName,
        productUrl: facts.productUrl,
        isPublished: facts.isPublished,
        images: facts.images,
        thin: !facts.description && !facts.shortDescription && facts.highlights.length === 0,
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load that product');
  }
}

/* ─── AI copy ───────────────────────────────────────────────────────────── */

const PLATFORMS = ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS', 'TIKTOK'] as const;

/**
 * Everything the three copy actions share: the permission, the rate limit,
 * and loading the product's verified facts.
 *
 * The rate limit is checked here rather than in the copywriter so that a
 * refusal costs nothing — no model call, no database read beyond the one
 * needed to know who is asking. This is what stops the endpoint being used
 * as a general-purpose Gemini proxy: it is reachable only by an
 * authenticated member of a store, only for a product that store owns, and
 * only a dozen times a minute.
 */
type CopyContext =
  | { ok: false; error: string }
  | {
      ok: true;
      organizationId: string;
      userId: string;
      facts: NonNullable<Awaited<ReturnType<typeof getProductFacts>>>;
      platform: SocialPlatform;
    };

async function copyContext(productId: string, platform: string): Promise<CopyContext> {
  const ctx = await getOrganizationContext();
  requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);

  if (!PLATFORMS.includes(platform as SocialPlatform)) {
    return { ok: false, error: 'Unknown platform' };
  }

  const limit = checkCopyRequest(ctx.organization.id, ctx.userId);
  if (!limit.ok) {
    return { ok: false, error: 'You’re writing faster than we can keep up. Try again in a minute.' };
  }

  const facts = await getProductFacts(ctx.organization.id, productId);
  if (!facts) return { ok: false, error: 'That product isn’t in this store’s catalogue' };

  return {
    ok: true,
    organizationId: ctx.organization.id,
    userId: ctx.userId,
    facts,
    platform: platform as SocialPlatform,
  };
}

export async function generatePostCaption(
  productId: string,
  platform: string,
): Promise<ActionResult<GeneratedCaption>> {
  try {
    const resolved = await copyContext(productId, platform);
    if (!resolved.ok) return { success: false, error: resolved.error };

    const caption = await generateCaption(resolved.organizationId, resolved.facts, resolved.platform);
    return { success: true, data: caption };
  } catch (error) {
    return copyFailure(error);
  }
}

export async function generatePostHashtags(
  productId: string,
  platform: string,
): Promise<ActionResult<string[]>> {
  try {
    const resolved = await copyContext(productId, platform);
    if (!resolved.ok) return { success: false, error: resolved.error };

    const hashtags = await generateHashtags(resolved.organizationId, resolved.facts, resolved.platform);
    return { success: true, data: hashtags };
  } catch (error) {
    return copyFailure(error);
  }
}

export async function rewritePostCaption(
  productId: string,
  platform: string,
  tone: string,
  current: string,
): Promise<ActionResult<GeneratedCaption>> {
  try {
    /* The tone is a key from a fixed list, never free text — otherwise
     * "rewrite" would be a way to pass an arbitrary instruction to Gemini. */
    if (!isRewriteTone(tone)) return { success: false, error: 'Unknown rewrite style' };
    if (!current.trim()) return { success: false, error: 'Write something first, then ask for a rewrite' };

    const resolved = await copyContext(productId, platform);
    if (!resolved.ok) return { success: false, error: resolved.error };

    const caption = await rewriteCaption(
      resolved.organizationId,
      resolved.facts,
      resolved.platform,
      tone,
      current,
    );
    return { success: true, data: caption };
  } catch (error) {
    return copyFailure(error);
  }
}

/** Character and hashtag limits, so the composer can show a counter. */
export async function getPlatformCopyStyle(
  platform: string,
): Promise<ActionResult<{ maxChars: number; hashtagCount: number }>> {
  if (!PLATFORMS.includes(platform as SocialPlatform)) return { success: false, error: 'Unknown platform' };
  return { success: true, data: platformCopyStyle(platform as SocialPlatform) };
}

/* ─── Publishing ────────────────────────────────────────────────────────── */

const PublishSchema = z.object({
  connectionId: z.string().min(1),
  productId: z.string().min(1),
  imageIds: z.array(z.string().min(1)).max(10),
  caption: z.string().trim().min(1, 'Write a caption before publishing').max(5_000),
  hashtags: z.array(z.string()).max(30),
  /*
   * Minted by the composer when the form is first opened and sent unchanged
   * with every attempt, so a double-click, a refresh or a retried server
   * action all land on the same row. A duplicate from a DIFFERENT composer
   * session is a different post, which is correct — a merchant may
   * legitimately post the same product twice.
   */
  idempotencyKey: z.string().min(8).max(100),
});

export type PublishPostInput = z.input<typeof PublishSchema>;

export async function publishSocialPost(
  input: PublishPostInput,
): Promise<ActionResult<SocialPostRow>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);

    const parsed = PublishSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

    const outcome = await publishPost(ctx.organization.id, ctx.userId, parsed.data);

    if (!outcome.ok) return { success: false, error: outcome.reason };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'social.post.published',
      entityType: 'SocialPost',
      entityId: outcome.post.id,
      metadata: {
        platform: outcome.post.platform,
        accountName: outcome.post.accountName,
        productName: outcome.post.productName,
      },
    });

    return { success: true, data: outcome.post };
  } catch (error) {
    return failure(error, 'We couldn’t publish that post');
  }
}

export async function retrySocialPost(postId: string): Promise<ActionResult<SocialPostRow>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);

    const outcome = await retryPost(ctx.organization.id, postId);
    if (!outcome.ok) return { success: false, error: outcome.reason };

    return { success: true, data: outcome.post };
  } catch (error) {
    return failure(error, 'We couldn’t retry that post');
  }
}

/* ─── History ───────────────────────────────────────────────────────────── */

export async function getSocialPosts(): Promise<ActionResult<SocialPostRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_VIEW);

    /* A server that died mid-publish leaves rows claimed forever; free them
     * whenever someone looks, rather than adding a cron service. */
    await releaseStalePublishing(ctx.organization.id);

    return { success: true, data: await listPosts(ctx.organization.id) };
  } catch (error) {
    return failure(error, 'We couldn’t load your posts');
  }
}

/** A fresh idempotency key for a newly opened composer. */
export async function newComposerKey(): Promise<string> {
  return randomUUID();
}
