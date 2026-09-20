'use server';

/*
 * features/social/actions.ts
 *
 * What the Social Commerce screens are allowed to do.
 *
 * Every action starts the same way: resolve the org from the SESSION
 * (getOrganizationContext reads the hostname the proxy stamped, never a
 * value from the form), then check the permission, then hand the
 * organizationId to lib/social/service.ts. A connection id arriving from the
 * browser is only ever used together with that organizationId, so it can
 * only ever address this store's own connections.
 *
 * Viewing needs `social.view`; connecting and disconnecting need
 * `social.manage`.
 *
 * No action here returns an access token, and none accepts one. Merchants do
 * not enter platform credentials anywhere in MansaaS — the Meta app belongs
 * to the platform (lib/social/providers/meta.ts).
 */
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { getAdminUrl } from '@/lib/tenant/urls';
import { getRootDomain, isLocalHostname } from '@/lib/tenant/resolveHostname';
import { metaRedirectUri } from '@/lib/social/config';
import {
  connectFromDraft,
  disconnectConnection,
  listConnections,
  readConnectionDraft,
  recheckConnection,
  discardConnectionDraft,
  purgeExpiredDrafts,
} from '@/lib/social/service';
import { getProvider, isProviderKey, listProviders, primaryPlatform, type ProviderKey } from '@/lib/social/registry';
import { createNonce, encodeState, STATE_COOKIE, stateCookieOptions } from '@/lib/social/state';
import { SocialProviderError, type SocialAccountRow, type SocialCandidate } from '@/lib/social/types';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

/* ─── Errors ────────────────────────────────────────────────────────────── */

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to manage social accounts' };
  }
  if (error instanceof SocialProviderError) {
    console.error('[social] provider error:', error.kind, error.message);
    switch (error.kind) {
      case 'not_configured':
        return { success: false, error: 'Social posting isn’t set up on this MansaaS installation yet' };
      case 'unsupported':
        return { success: false, error: 'That platform isn’t available yet' };
      case 'invalid_state':
        return { success: false, error: 'That connection attempt has expired. Start again.' };
      case 'rate_limited':
        return { success: false, error: 'Facebook is busy right now. Try again in a few minutes.' };
      default:
        return { success: false, error: 'We couldn’t reach Facebook. Try again in a moment.' };
    }
  }
  console.error(`[social] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/* ─── Reading ───────────────────────────────────────────────────────────── */

export interface SocialOverview {
  accounts: SocialAccountRow[];
  providers: { key: ProviderKey; label: string; configured: boolean; reason: string | null }[];
}

export async function getSocialOverview(): Promise<ActionResult<SocialOverview>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_VIEW);

    // Abandoned drafts hold Page tokens; clear them whenever anyone looks.
    await purgeExpiredDrafts();

    return {
      success: true,
      data: { accounts: await listConnections(ctx.organization.id), providers: listProviders() },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your connected accounts');
  }
}

/* ─── Starting a connection ─────────────────────────────────────────────── */

/**
 * Builds the authorization URL and arms the CSRF nonce.
 *
 * Returns the URL rather than redirecting, so the button can show its
 * spinner and the caller can surface a clear error when the platform isn't
 * configured — a redirect into a Meta error page explains nothing.
 */
export async function startSocialConnect(providerKey: string): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);

    if (!isProviderKey(providerKey)) {
      return { success: false, error: 'Unknown platform' };
    }

    const provider = getProvider(providerKey);
    if (!provider.isConfigured()) {
      return { success: false, error: provider.unavailableReason() ?? 'That platform isn’t available yet' };
    }

    const nonce = createNonce();
    const state = encodeState({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      nonce,
      provider: primaryPlatform(providerKey),
      returnTo: getAdminUrl(ctx.organization.slug, '/social'),
    });

    const root = getRootDomain();
    const jar = await cookies();
    jar.set(STATE_COOKIE, nonce, stateCookieOptions(root, !isLocalHostname(root)));

    return {
      success: true,
      data: { url: provider.buildAuthorizationUrl({ state, redirectUri: metaRedirectUri() }) },
    };
  } catch (error) {
    return failure(error, 'We couldn’t start the connection');
  }
}

/* ─── Choosing accounts ─────────────────────────────────────────────────── */

export async function getConnectionDraft(draftId: string): Promise<ActionResult<{ candidates: SocialCandidate[] }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);

    const draft = await readConnectionDraft(ctx.organization.id, ctx.userId, draftId);
    if (!draft) {
      return { success: false, error: 'That connection attempt has expired. Start again.' };
    }
    return { success: true, data: { candidates: draft.candidates } };
  } catch (error) {
    return failure(error, 'We couldn’t load the accounts Facebook returned');
  }
}

const SelectionSchema = z.object({
  draftId: z.string().min(1),
  selections: z
    .array(
      z.object({
        platform: z.enum(['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS', 'TIKTOK']),
        platformAccountId: z.string().min(1),
      }),
    )
    .min(1, 'Choose at least one account to connect'),
});

export async function completeSocialConnect(
  input: z.input<typeof SelectionSchema>,
): Promise<ActionResult<{ connected: SocialAccountRow[] }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);

    const parsed = SelectionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { connected } = await connectFromDraft(
      ctx.organization.id,
      ctx.userId,
      parsed.data.draftId,
      parsed.data.selections,
    );

    for (const account of connected) {
      await createAuditLog({
        organizationId: ctx.organization.id,
        userId: ctx.userId,
        action: 'social.connection.created',
        entityType: 'SocialConnection',
        entityId: account.id,
        metadata: { platform: account.platform, accountName: account.accountName },
      });
    }

    return { success: true, data: { connected } };
  } catch (error) {
    return failure(error, 'We couldn’t connect those accounts');
  }
}

export async function cancelSocialConnect(draftId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);
    await discardConnectionDraft(ctx.organization.id, ctx.userId, draftId);
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t cancel that');
  }
}

/* ─── Managing what's connected ─────────────────────────────────────────── */

export async function disconnectSocialAccount(connectionId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);

    /* The org id comes from the session, the connection id from the browser,
     * and the service only accepts them together — so another store's id
     * lands here as "not found". */
    const removed = await disconnectConnection(ctx.organization.id, connectionId);
    if (!removed) {
      return { success: false, error: 'That account isn’t connected to this store' };
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'social.connection.disconnected',
      entityType: 'SocialConnection',
      entityId: connectionId,
      metadata: { platform: removed.platform, accountName: removed.accountName },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t disconnect that account');
  }
}

export async function recheckSocialAccount(connectionId: string): Promise<ActionResult<SocialAccountRow>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE);

    const row = await recheckConnection(ctx.organization.id, connectionId);
    if (!row) return { success: false, error: 'That account isn’t connected to this store' };
    return { success: true, data: row };
  } catch (error) {
    return failure(error, 'We couldn’t check that account');
  }
}
