/*
 * Loads "Get your shop ready" for the current workspace and decides whether
 * to show it (ROADMAP 12.5). On the dashboard it's for Owners and Admins, until
 * the shop is set up and open or the guide is hidden; in Settings → Setup
 * guide it's always there.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, SYSTEM_ROLES } from '@/lib/permissions';
import { getSetupProgress } from '@/lib/onboarding/setup-guide';
import type { SetupStepKey } from '@/lib/onboarding/setup-steps';
import { SetupGuide } from './setup-guide';
import { storefrontUrlFor } from '@/lib/domains/storefront-url';

export async function SetupGuideSection({ variant }: { variant: 'dashboard' | 'settings' }) {
  const ctx = await getOrganizationContext();
  const role = ctx.membership.role;
  const leads = role.isSystem && (role.name === SYSTEM_ROLES.OWNER.name || role.name === SYSTEM_ROLES.ADMIN.name);

  const [progress, org] = await Promise.all([
    getSetupProgress(ctx.organization.id),
    prisma.organization.findUnique({ where: { id: ctx.organization.id }, select: { setupGuideDismissedAt: true } }),
  ]);
  if (!progress) return null;
  if (variant === 'dashboard' && (!leads || org?.setupGuideDismissedAt || progress.complete)) return null;

  const allowed = Object.fromEntries(
    progress.steps.map((s) => [s.key, hasPermission(role.permissions, s.permission)]),
  ) as Record<SetupStepKey, boolean>;

  return (
    <SetupGuide
      progress={progress}
      allowed={allowed}
      storefrontUrl={(await storefrontUrlFor(ctx.organization.slug))}
      variant={variant}
    />
  );
}
