/*
 * lib/social/service.ts
 *
 * THE tenant boundary for social connections. Every read and every write
 * goes through here, and every function takes `organizationId` as its first
 * argument — never an id the browser chose on its own.
 *
 * The rules this file exists to enforce:
 *
 *   1. A connection is reached by BOTH its id and its organizationId, always
 *      (`where: { id, organizationId }`). A merchant who guesses another
 *      store's connection id gets "not found", not someone else's Page.
 *   2. Tokens are sealed on the way in and only opened here, to hand
 *      straight to a provider. No function returns a token to its caller.
 *   3. What leaves this module for the UI is `SocialAccountRow`, which has
 *      no token field at all — so there is no way to leak one by forgetting
 *      to strip it.
 *
 * Callers: features/social/actions.ts (has org context from the session) and
 * app/api/social/meta/callback/route.ts (has an organizationId it re-verified
 * against a membership before calling anything here).
 */
import { prisma } from '@/lib/prisma';
import { openJson, seal, sealJson, open } from './crypto';
import { getProviderForPlatform } from './registry';
import {
  SocialProviderError,
  type ProviderAccount,
  type SocialAccountRow,
  type SocialCandidate,
  type SocialConnectionStatus,
  type SocialPlatform,
} from './types';

/** A draft is a handoff, not storage: long enough to choose, short enough to be safe. */
const DRAFT_TTL_MS = 15 * 60 * 1000;

/* ─── Reading ───────────────────────────────────────────────────────────── */

/** Why a connection isn't working, in words a shop owner can act on. */
function problemFor(status: SocialConnectionStatus, code: string | null): string | null {
  switch (status) {
    case 'ACTIVE':
    case 'DISCONNECTED':
      return null;
    case 'EXPIRED':
      return 'The permission MansaaS was given has run out. Reconnect this account to keep posting.';
    case 'REVOKED':
      return code === '190/458'
        ? 'This account removed MansaaS from its Facebook settings. Reconnect to restore access.'
        : 'Facebook is no longer accepting our access to this account. Reconnect to restore it.';
  }
}

type ConnectionRecord = {
  id: string;
  platform: SocialPlatform;
  accountName: string;
  username: string | null;
  avatarUrl: string | null;
  status: SocialConnectionStatus;
  connectedAt: Date;
  lastCheckedAt: Date | null;
  lastErrorCode: string | null;
  parentConnectionId: string | null;
};

/** The only mapper into a client-facing shape. Note: no token is selected. */
function toRow(record: ConnectionRecord): SocialAccountRow {
  return {
    id: record.id,
    platform: record.platform,
    accountName: record.accountName,
    username: record.username,
    avatarUrl: record.avatarUrl,
    status: record.status,
    connectedAt: record.connectedAt.toISOString(),
    lastCheckedAt: record.lastCheckedAt?.toISOString() ?? null,
    problem: problemFor(record.status, record.lastErrorCode),
    parentConnectionId: record.parentConnectionId,
  };
}

/** Field set shared by every read. Deliberately omits `accessTokenCipher`. */
const ROW_FIELDS = {
  id: true,
  platform: true,
  accountName: true,
  username: true,
  avatarUrl: true,
  status: true,
  connectedAt: true,
  lastCheckedAt: true,
  lastErrorCode: true,
  parentConnectionId: true,
} as const;

/** Every account this store has connected, newest first. */
export async function listConnections(organizationId: string): Promise<SocialAccountRow[]> {
  const rows = await prisma.socialConnection.findMany({
    where: { organizationId, status: { not: 'DISCONNECTED' } },
    select: ROW_FIELDS,
    orderBy: [{ platform: 'asc' }, { connectedAt: 'desc' }],
  });
  return rows.map(toRow);
}

/* ─── Drafts: the callback → chooser handoff ────────────────────────────── */

interface DraftPayload {
  accounts: ProviderAccount[];
  grantedScopes: string[];
}

/**
 * Parks the accounts Meta returned, encrypted and bound to this store and
 * this member. Called by the callback route, which has no session-derived
 * org context — it passes the organizationId it re-verified.
 */
export async function createConnectionDraft(
  organizationId: string,
  userId: string,
  provider: SocialPlatform,
  payload: DraftPayload,
): Promise<string> {
  /* One live draft per member per store: a merchant who restarts the flow
   * shouldn't leave the previous batch of Page tokens lying around. */
  await prisma.socialConnectionDraft.deleteMany({ where: { organizationId, userId } });

  const draft = await prisma.socialConnectionDraft.create({
    data: {
      organizationId,
      userId,
      provider,
      payloadCipher: sealJson(payload),
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
    },
    select: { id: true },
  });
  return draft.id;
}

/**
 * Reads a draft for the chooser. Scoped by store AND member, so a draft id
 * shared or guessed is useless to anyone else. Does not delete it: the
 * merchant may look at the list before choosing.
 */
export async function readConnectionDraft(
  organizationId: string,
  userId: string,
  draftId: string,
): Promise<{ candidates: SocialCandidate[]; provider: SocialPlatform } | null> {
  const draft = await prisma.socialConnectionDraft.findFirst({
    where: { id: draftId, organizationId, userId, expiresAt: { gt: new Date() } },
    select: { payloadCipher: true, provider: true },
  });
  if (!draft) return null;

  const payload = openJson<DraftPayload>(draft.payloadCipher);

  const connected = await prisma.socialConnection.findMany({
    where: { organizationId, status: { not: 'DISCONNECTED' } },
    select: { platform: true, platformAccountId: true },
  });
  const connectedKeys = new Set(connected.map((c) => `${c.platform}:${c.platformAccountId}`));

  const candidates: SocialCandidate[] = payload.accounts.map((account) => ({
    platformAccountId: account.platformAccountId,
    platform: account.platform,
    accountName: account.accountName,
    username: account.username,
    avatarUrl: account.avatarUrl,
    alreadyConnected: connectedKeys.has(`${account.platform}:${account.platformAccountId}`),
    unavailableReason: account.unavailableReason,
    parentAccountId: account.parentAccountId,
  }));

  return { candidates, provider: draft.provider };
}

export async function discardConnectionDraft(
  organizationId: string,
  userId: string,
  draftId: string,
): Promise<void> {
  await prisma.socialConnectionDraft.deleteMany({ where: { id: draftId, organizationId, userId } });
}

/* ─── Writing ───────────────────────────────────────────────────────────── */

export interface ConnectSelection {
  platform: SocialPlatform;
  platformAccountId: string;
}

/**
 * Connects the accounts the merchant picked out of a draft.
 *
 * Only accounts present in THAT draft can be connected: the selection from
 * the browser is matched against the parked list, never trusted as a
 * description of an account. Anything unmatched is ignored, so a crafted
 * request can at most connect something the merchant already authorised.
 *
 * Reconnecting an account the store already has updates its row — the same
 * Page keeps one identity and its history, rather than accumulating
 * duplicates.
 */
export async function connectFromDraft(
  organizationId: string,
  userId: string,
  draftId: string,
  selections: ConnectSelection[],
): Promise<{ connected: SocialAccountRow[] }> {
  const draft = await prisma.socialConnectionDraft.findFirst({
    where: { id: draftId, organizationId, userId, expiresAt: { gt: new Date() } },
    select: { id: true, payloadCipher: true },
  });
  if (!draft) {
    throw new SocialProviderError('invalid_state', 'That connection attempt has expired. Start again.');
  }

  const payload = openJson<DraftPayload>(draft.payloadCipher);
  const wanted = new Set(selections.map((s) => `${s.platform}:${s.platformAccountId}`));

  const chosen = payload.accounts.filter(
    (account) =>
      wanted.has(`${account.platform}:${account.platformAccountId}`) &&
      !account.unavailableReason &&
      account.accessToken,
  );

  if (chosen.length === 0) {
    throw new SocialProviderError('denied', 'None of the selected accounts can be connected');
  }

  /* Pages first, so an Instagram account can point at the row of the Page it
   * publishes through in the same pass. */
  const ordered = [...chosen].sort((a) => (a.platform === 'FACEBOOK_PAGE' ? -1 : 1));
  const pageRowIds = new Map<string, string>();
  const connected: SocialAccountRow[] = [];

  for (const account of ordered) {
    const parentConnectionId = account.parentAccountId ? (pageRowIds.get(account.parentAccountId) ?? null) : null;

    const data = {
      accountName: account.accountName,
      username: account.username,
      avatarUrl: account.avatarUrl,
      accessTokenCipher: seal(account.accessToken),
      tokenExpiresAt: account.tokenExpiresAt,
      scopes: account.scopes,
      status: 'ACTIVE' as const,
      lastCheckedAt: new Date(),
      lastErrorCode: null,
      parentConnectionId,
      connectedByUserId: userId,
      connectedAt: new Date(),
      disconnectedAt: null,
    };

    const row = await prisma.socialConnection.upsert({
      where: {
        organizationId_platform_platformAccountId: {
          organizationId,
          platform: account.platform,
          platformAccountId: account.platformAccountId,
        },
      },
      create: {
        organizationId,
        platform: account.platform,
        platformAccountId: account.platformAccountId,
        ...data,
      },
      update: data,
      select: ROW_FIELDS,
    });

    if (account.platform === 'FACEBOOK_PAGE') pageRowIds.set(account.platformAccountId, row.id);
    connected.push(toRow(row));
  }

  // The tokens have found their permanent, encrypted home; the copy in the
  // draft must not outlive that.
  await prisma.socialConnectionDraft.delete({ where: { id: draft.id } });

  return { connected };
}

/**
 * Disconnects one account.
 *
 * The compound `where` is the tenant check: a connection id belonging to
 * another store simply isn't found. Meta is told afterwards, best effort —
 * the merchant asked for this to stop, so a Meta outage must not leave the
 * row connected.
 */
export async function disconnectConnection(
  organizationId: string,
  connectionId: string,
): Promise<{ accountName: string; platform: SocialPlatform } | null> {
  const connection = await prisma.socialConnection.findFirst({
    where: { id: connectionId, organizationId },
    select: {
      id: true,
      platform: true,
      accountName: true,
      platformAccountId: true,
      accessTokenCipher: true,
      status: true,
    },
  });
  if (!connection) return null;

  /* An Instagram account publishes on its Page's token, so disconnecting the
   * Page must take the Instagram account with it — leaving it listed as
   * "Connected" would be a promise the app can't keep. */
  await prisma.socialConnection.updateMany({
    where: {
      organizationId,
      OR: [{ id: connection.id }, { parentConnectionId: connection.id }],
    },
    data: { status: 'DISCONNECTED', disconnectedAt: new Date(), accessTokenCipher: '' },
  });

  if (connection.status === 'ACTIVE' && connection.accessTokenCipher) {
    try {
      const provider = getProviderForPlatform(connection.platform);
      await provider.revoke(open(connection.accessTokenCipher), connection.platformAccountId);
    } catch (error) {
      console.error('[social] revoke at provider failed (local disconnect stands):', error);
    }
  }

  return { accountName: connection.accountName, platform: connection.platform };
}

/**
 * Asks the platform whether a stored token still works, and records the
 * answer. Explicit rather than automatic on page load: a Graph call per
 * connection on every render would make the page slow and would rate-limit
 * a busy store for no benefit.
 */
export async function recheckConnection(
  organizationId: string,
  connectionId: string,
): Promise<SocialAccountRow | null> {
  const connection = await prisma.socialConnection.findFirst({
    where: { id: connectionId, organizationId, status: { not: 'DISCONNECTED' } },
    select: { id: true, platform: true, platformAccountId: true, accessTokenCipher: true },
  });
  if (!connection) return null;

  let status: SocialConnectionStatus = 'ACTIVE';
  let lastErrorCode: string | null = null;

  try {
    const provider = getProviderForPlatform(connection.platform);
    const result = await provider.verifyToken(open(connection.accessTokenCipher), connection.platformAccountId);
    if (!result.ok) {
      lastErrorCode = result.code ?? null;
      if (result.kind === 'token_invalid') status = 'REVOKED';
      else if (result.kind === 'permission_missing') status = 'EXPIRED';
      else return toRow(await touchChecked(connection.id, organizationId)); // transient: leave status alone
    }
  } catch (error) {
    console.error('[social] recheck failed:', error);
    return toRow(await touchChecked(connection.id, organizationId));
  }

  const updated = await prisma.socialConnection.update({
    where: { id: connection.id },
    data: { status, lastErrorCode, lastCheckedAt: new Date() },
    select: ROW_FIELDS,
  });
  return toRow(updated);
}

/** Records that we looked, without claiming to know more than we do. */
async function touchChecked(id: string, organizationId: string): Promise<ConnectionRecord> {
  await prisma.socialConnection.updateMany({
    where: { id, organizationId },
    data: { lastCheckedAt: new Date() },
  });
  return prisma.socialConnection.findFirstOrThrow({ where: { id, organizationId }, select: ROW_FIELDS });
}

/**
 * Deletes drafts nobody came back for. Called opportunistically when the
 * social page loads, so abandoned Page tokens don't sit around waiting for a
 * cron job that this phase doesn't have.
 */
export async function purgeExpiredDrafts(): Promise<void> {
  try {
    await prisma.socialConnectionDraft.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (error) {
    console.error('[social] purging expired drafts failed:', error);
  }
}
