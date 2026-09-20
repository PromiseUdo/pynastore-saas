/*
 * Tenant isolation for social connections.
 *
 * This is the one bug this layer may never have: a merchant reaching another
 * merchant's Facebook Page. Every function in lib/social/service.ts takes an
 * organizationId and pairs it with the id it was given, so these tests drive
 * the real service against an in-memory store that honours `where` the way
 * Postgres would, and assert that store B's requests find nothing — not that
 * they're refused with a message, but that another store's rows are simply
 * not visible.
 *
 * The second thing asserted here: no function that returns data to a caller
 * returns a token. The rows keep `accessTokenCipher`; the returned shapes
 * don't have the field at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

type Row = Record<string, unknown>;

const connections: Row[] = [];
const drafts: Row[] = [];
let sequence = 0;

/** The subset of `where` the service actually uses. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'OR') {
      const clauses = expected as Row[];
      if (!clauses.some((clause) => matches(row, clause))) return false;
      continue;
    }
    const actual = row[key];
    if (expected && typeof expected === 'object') {
      const condition = expected as { not?: unknown; gt?: Date; lt?: Date };
      if ('not' in condition && actual === condition.not) return false;
      if ('gt' in condition && !((actual as Date) > (condition.gt as Date))) return false;
      if ('lt' in condition && !((actual as Date) < (condition.lt as Date))) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function project(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const key of Object.keys(select)) out[key] = row[key];
  return out;
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    socialConnection: {
      findMany: async ({ where, select }: { where?: Row; select?: Record<string, boolean> }) =>
        connections.filter((row) => matches(row, where)).map((row) => project(row, select)),

      findFirst: async ({ where, select }: { where?: Row; select?: Record<string, boolean> }) => {
        const row = connections.find((candidate) => matches(candidate, where));
        return row ? project(row, select) : null;
      },

      findFirstOrThrow: async ({ where, select }: { where?: Row; select?: Record<string, boolean> }) => {
        const row = connections.find((candidate) => matches(candidate, where));
        if (!row) throw new Error('not found');
        return project(row, select);
      },

      upsert: async ({
        where,
        create,
        update,
        select,
      }: {
        where: { organizationId_platform_platformAccountId: Row };
        create: Row;
        update: Row;
        select?: Record<string, boolean>;
      }) => {
        const key = where.organizationId_platform_platformAccountId;
        const existing = connections.find((row) => matches(row, key));
        if (existing) {
          Object.assign(existing, update);
          return project(existing, select);
        }
        const row: Row = { id: `conn_${++sequence}`, ...create };
        connections.push(row);
        return project(row, select);
      },

      update: async ({ where, data, select }: { where: { id: string }; data: Row; select?: Record<string, boolean> }) => {
        const row = connections.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return project(row, select);
      },

      updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
        let count = 0;
        for (const row of connections) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },

    socialConnectionDraft: {
      create: async ({ data, select }: { data: Row; select?: Record<string, boolean> }) => {
        const row: Row = { id: `draft_${++sequence}`, ...data };
        drafts.push(row);
        return project(row, select);
      },
      findFirst: async ({ where, select }: { where?: Row; select?: Record<string, boolean> }) => {
        const row = drafts.find((candidate) => matches(candidate, where));
        return row ? project(row, select) : null;
      },
      deleteMany: async ({ where }: { where?: Row }) => {
        let count = 0;
        for (let i = drafts.length - 1; i >= 0; i -= 1) {
          if (matches(drafts[i], where)) {
            drafts.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = drafts.findIndex((row) => row.id === where.id);
        if (index >= 0) drafts.splice(index, 1);
        return {};
      },
    },
  },
}));

const { createConnectionDraft, connectFromDraft, listConnections, disconnectConnection, readConnectionDraft } =
  await import('./service');

const STORE_A = 'org_a';
const STORE_B = 'org_b';
const USER_A = 'user_a';
const USER_B = 'user_b';

function pageAccount(id: string, name: string) {
  return {
    platform: 'FACEBOOK_PAGE' as const,
    platformAccountId: id,
    accountName: name,
    username: null,
    avatarUrl: null,
    accessToken: `TOKEN_FOR_${id}`,
    tokenExpiresAt: null,
    scopes: ['pages_show_list'],
    parentAccountId: null,
    unavailableReason: null,
  };
}

/** Connects one Page to a store, the way the real flow would. */
async function connectPage(organizationId: string, userId: string, pageId: string, name: string) {
  const draftId = await createConnectionDraft(organizationId, userId, 'FACEBOOK_PAGE', {
    accounts: [pageAccount(pageId, name)],
    grantedScopes: ['pages_show_list'],
  });
  const { connected } = await connectFromDraft(organizationId, userId, draftId, [
    { platform: 'FACEBOOK_PAGE', platformAccountId: pageId },
  ]);
  return connected[0];
}

beforeEach(() => {
  connections.length = 0;
  drafts.length = 0;
  sequence = 0;
});

describe('one store cannot reach another store’s connections', () => {
  it('lists only its own accounts', async () => {
    await connectPage(STORE_A, USER_A, 'page_a', 'Acme Store');
    await connectPage(STORE_B, USER_B, 'page_b', 'Bola Fabrics');

    const seenByA = await listConnections(STORE_A);
    const seenByB = await listConnections(STORE_B);

    expect(seenByA.map((row) => row.accountName)).toEqual(['Acme Store']);
    expect(seenByB.map((row) => row.accountName)).toEqual(['Bola Fabrics']);
  });

  it('cannot disconnect a connection id belonging to another store', async () => {
    const aPage = await connectPage(STORE_A, USER_A, 'page_a', 'Acme Store');

    // Store B knows the id — and it still gets nothing.
    expect(await disconnectConnection(STORE_B, aPage.id)).toBeNull();

    const stillThere = await listConnections(STORE_A);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].status).toBe('ACTIVE');
  });

  it('disconnects its own connection', async () => {
    const aPage = await connectPage(STORE_A, USER_A, 'page_a', 'Acme Store');
    expect(await disconnectConnection(STORE_A, aPage.id)).toMatchObject({ accountName: 'Acme Store' });
    expect(await listConnections(STORE_A)).toHaveLength(0);
  });

  it('takes a linked Instagram account down with its Page', async () => {
    const draftId = await createConnectionDraft(STORE_A, USER_A, 'FACEBOOK_PAGE', {
      accounts: [
        pageAccount('page_a', 'Acme Store'),
        {
          ...pageAccount('ig_a', 'Acme on Instagram'),
          platform: 'INSTAGRAM_BUSINESS' as const,
          parentAccountId: 'page_a',
        },
      ],
      grantedScopes: ['pages_show_list', 'instagram_basic'],
    });
    const { connected } = await connectFromDraft(STORE_A, USER_A, draftId, [
      { platform: 'FACEBOOK_PAGE', platformAccountId: 'page_a' },
      { platform: 'INSTAGRAM_BUSINESS', platformAccountId: 'ig_a' },
    ]);
    expect(connected).toHaveLength(2);

    const page = connected.find((row) => row.platform === 'FACEBOOK_PAGE')!;
    await disconnectConnection(STORE_A, page.id);

    expect(await listConnections(STORE_A)).toHaveLength(0);
  });
});

describe('drafts are bound to the store and the member who started them', () => {
  it('is invisible to another store', async () => {
    const draftId = await createConnectionDraft(STORE_A, USER_A, 'FACEBOOK_PAGE', {
      accounts: [pageAccount('page_a', 'Acme Store')],
      grantedScopes: [],
    });
    expect(await readConnectionDraft(STORE_B, USER_B, draftId)).toBeNull();
    expect(await readConnectionDraft(STORE_B, USER_A, draftId)).toBeNull();
  });

  it('is invisible to another member of the same store', async () => {
    const draftId = await createConnectionDraft(STORE_A, USER_A, 'FACEBOOK_PAGE', {
      accounts: [pageAccount('page_a', 'Acme Store')],
      grantedScopes: [],
    });
    expect(await readConnectionDraft(STORE_A, USER_B, draftId)).toBeNull();
  });

  it('cannot be redeemed by another store', async () => {
    const draftId = await createConnectionDraft(STORE_A, USER_A, 'FACEBOOK_PAGE', {
      accounts: [pageAccount('page_a', 'Acme Store')],
      grantedScopes: [],
    });
    await expect(
      connectFromDraft(STORE_B, USER_B, draftId, [{ platform: 'FACEBOOK_PAGE', platformAccountId: 'page_a' }]),
    ).rejects.toThrow();
    expect(await listConnections(STORE_B)).toHaveLength(0);
  });

  it('only connects accounts that were actually in the draft', async () => {
    const draftId = await createConnectionDraft(STORE_A, USER_A, 'FACEBOOK_PAGE', {
      accounts: [pageAccount('page_a', 'Acme Store')],
      grantedScopes: [],
    });
    // A crafted selection naming a Page the merchant never authorised.
    await expect(
      connectFromDraft(STORE_A, USER_A, draftId, [
        { platform: 'FACEBOOK_PAGE', platformAccountId: 'page_somebody_else' },
      ]),
    ).rejects.toThrow();
    expect(await listConnections(STORE_A)).toHaveLength(0);
  });

  it('is spent once it has been redeemed', async () => {
    const draftId = await createConnectionDraft(STORE_A, USER_A, 'FACEBOOK_PAGE', {
      accounts: [pageAccount('page_a', 'Acme Store')],
      grantedScopes: [],
    });
    await connectFromDraft(STORE_A, USER_A, draftId, [{ platform: 'FACEBOOK_PAGE', platformAccountId: 'page_a' }]);
    expect(await readConnectionDraft(STORE_A, USER_A, draftId)).toBeNull();
  });
});

describe('tokens never leave the server side of the seam', () => {
  it('stores the token encrypted, not in the clear', async () => {
    await connectPage(STORE_A, USER_A, 'page_a', 'Acme Store');
    const stored = connections[0].accessTokenCipher as string;
    expect(stored).not.toContain('TOKEN_FOR_page_a');
    expect(stored.startsWith('v1.')).toBe(true);
  });

  it('returns no token field to any caller', async () => {
    const connected = await connectPage(STORE_A, USER_A, 'page_a', 'Acme Store');
    const listed = await listConnections(STORE_A);

    for (const row of [connected, ...listed]) {
      expect(Object.keys(row)).not.toContain('accessTokenCipher');
      expect(JSON.stringify(row)).not.toContain('TOKEN_FOR_page_a');
    }
  });

  it('gives the chooser candidates with no token on them', async () => {
    const draftId = await createConnectionDraft(STORE_A, USER_A, 'FACEBOOK_PAGE', {
      accounts: [pageAccount('page_a', 'Acme Store')],
      grantedScopes: [],
    });
    const draft = await readConnectionDraft(STORE_A, USER_A, draftId);
    expect(JSON.stringify(draft)).not.toContain('TOKEN_FOR_page_a');
    expect(Object.keys(draft!.candidates[0])).not.toContain('accessToken');
  });

  it('forgets the stored token when an account is disconnected', async () => {
    const aPage = await connectPage(STORE_A, USER_A, 'page_a', 'Acme Store');
    await disconnectConnection(STORE_A, aPage.id);
    expect(connections[0].accessTokenCipher).toBe('');
  });
});
