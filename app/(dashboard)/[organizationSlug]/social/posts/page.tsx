/*
 * Social Commerce → Post history.
 *
 * What was posted, where it went, and what happened. A post that failed says
 * why and offers a retry — the record keeps everything needed to try again,
 * so nothing has to be retyped.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getSocialPosts } from '@/features/social/posts';
import { PostHistoryClient } from './_components/PostHistoryClient';

export const metadata: Metadata = { title: 'Post history' };

export default async function SocialPostsPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;

  if (!hasPermission(perms, PERMISSIONS.SOCIAL_VIEW)) return <AccessDenied what="social posts" />;

  const result = await getSocialPosts();
  if (!result.success) throw new Error(result.error);

  return <PostHistoryClient posts={result.data} canManage={hasPermission(perms, PERMISSIONS.SOCIAL_MANAGE)} />;
}
