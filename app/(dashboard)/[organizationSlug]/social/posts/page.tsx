/*
 * Social Commerce → Post history.
 *
 * What was posted, where it went, and what happened. A post that failed says
 * why and offers a retry — the record keeps everything needed to try again,
 * so nothing has to be retyped.
 *
 * Filters, search and the page number live in the URL (AGENTS.md §3) and are
 * applied by the database, not the browser: a store that posts daily should
 * never have to download its whole history to look at one week of it.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getSocialPosts } from '@/features/social/posts';
import { SocialPlatform, SocialPostStatus } from '@/lib/generated/prisma/enums';
import type { SocialPostListParams } from '@/lib/social/types';
import { PostHistoryClient } from './_components/PostHistoryClient';

export const metadata: Metadata = { title: 'Post history' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/** A date from the URL, or undefined — never an Invalid Date in a query. */
function day(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Reads the URL into list params, dropping anything unrecognised.
 *
 * Nothing here can widen what the query returns: the organization is added
 * by the service from the session, and every value that survives this
 * function is a filter that only narrows.
 */
function parseParams(raw: Record<string, string | string[] | undefined>): SocialPostListParams {
  const status = one(raw.status);
  const platform = one(raw.platform);
  const page = Number(one(raw.page));

  return {
    q: one(raw.q),
    status: status && status in SocialPostStatus ? (status as SocialPostStatus) : undefined,
    platform: platform && platform in SocialPlatform ? (platform as SocialPlatform) : undefined,
    productId: one(raw.product),
    from: day(one(raw.from)),
    to: day(one(raw.to), true),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    perPage: 20,
  };
}

export default async function SocialPostsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;

  if (!hasPermission(perms, PERMISSIONS.SOCIAL_VIEW)) return <AccessDenied what="social posts" />;

  const params = parseParams(await searchParams);
  const result = await getSocialPosts(params);
  if (!result.success) throw new Error(result.error);

  return (
    <PostHistoryClient
      result={result.data}
      canManage={hasPermission(perms, PERMISSIONS.SOCIAL_MANAGE)}
    />
  );
}
