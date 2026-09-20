/*
 * Social Commerce → Create post.
 *
 * A merchant picks one of their connected accounts, one of their own
 * products, its images, and writes (or asks Gemini to write) a caption.
 * Nothing publishes until they press Publish.
 *
 * The destinations and the idempotency key are prepared on the server: the
 * key is minted once per opened composer so a double-click can't become two
 * posts (lib/social/publish.ts).
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getPostDestinations, newComposerKey } from '@/features/social/posts';
import { ComposerClient } from './_components/ComposerClient';

export const metadata: Metadata = { title: 'Create post' };

export default async function ComposePage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;

  if (!hasPermission(perms, PERMISSIONS.SOCIAL_MANAGE)) {
    return <AccessDenied what="creating social posts" />;
  }

  const destinations = await getPostDestinations();
  if (!destinations.success) throw new Error(destinations.error);

  return (
    <ComposerClient
      destinations={destinations.data}
      composerKey={await newComposerKey()}
      canBrowseCatalogue={hasPermission(perms, PERMISSIONS.INVENTORY_VIEW)}
    />
  );
}
