/*
 * The Google-handoff ticket.
 *
 * A ticket is the only thing that crosses from the root domain to a store's
 * own origin carrying the right to a session, so it has to be: usable once,
 * briefly, and only at the store it was minted for. Prisma is stubbed with
 * an in-memory table — the point of the test is the claiming logic, not the
 * database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const rows = new Map<string, { id: string; usedAt: Date | null; expiresAt: Date }>();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customerAuthHandoff: {
      create: async ({ data }: { data: { id: string; expiresAt: Date } }) => {
        rows.set(data.id, { id: data.id, usedAt: null, expiresAt: data.expiresAt });
        return data;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; usedAt: null; expiresAt: { gt: Date } };
        data: { usedAt: Date };
      }) => {
        const row = rows.get(where.id);
        if (!row || row.usedAt || row.expiresAt <= where.expiresAt.gt) return { count: 0 };
        row.usedAt = data.usedAt;
        return { count: 1 };
      },
      deleteMany: async () => ({ count: 0 }),
    },
  },
}));

const { mintHandoffToken, consumeHandoffToken } = await import('./handoff');

const CLAIMS = {
  customerId: 'cus_ada',
  organizationId: 'org_acme',
  slug: 'acme',
  sessionVersion: 3,
};

beforeEach(() => {
  rows.clear();
  process.env.AUTH_SECRET ||= 'test-secret-for-storefront-sessions';
});

const VERIFIER = 'v'.repeat(43);
const CHALLENGE = (await import('crypto')).createHash('sha256').update(VERIFIER).digest('base64url');

describe('handoff tickets minted for a phone app (ROADMAP 16.1)', () => {
  it('are spent only with the verifier the app kept', async () => {
    const token = await mintHandoffToken(CLAIMS, { challenge: CHALLENGE });
    await expect(consumeHandoffToken(token, 'acme', VERIFIER)).resolves.toEqual(CLAIMS);
  });

  it('are worthless to whoever catches the deep link without it', async () => {
    const token = await mintHandoffToken(CLAIMS, { challenge: CHALLENGE });
    await expect(consumeHandoffToken(token, 'acme')).resolves.toBeNull();
    await expect(consumeHandoffToken(token, 'acme', 'w'.repeat(43))).resolves.toBeNull();
    // ...and a wrong guess doesn't burn it for the app.
    await expect(consumeHandoffToken(token, 'acme', VERIFIER)).resolves.toEqual(CLAIMS);
  });

  it("don't change web tickets, which need no verifier", async () => {
    const token = await mintHandoffToken(CLAIMS);
    await expect(consumeHandoffToken(token, 'acme', null)).resolves.toEqual(CLAIMS);
  });
});

describe('handoff tickets', () => {
  it('can be spent once at the store it names', async () => {
    const token = await mintHandoffToken(CLAIMS);
    await expect(consumeHandoffToken(token, 'acme')).resolves.toEqual(CLAIMS);
  });

  it('cannot be spent twice — two tabs racing get one session, not two', async () => {
    const token = await mintHandoffToken(CLAIMS);
    await consumeHandoffToken(token, 'acme');
    await expect(consumeHandoffToken(token, 'acme')).resolves.toBeNull();
  });

  it('is worthless at another store, even before it is spent', async () => {
    const token = await mintHandoffToken(CLAIMS);
    await expect(consumeHandoffToken(token, 'zed')).resolves.toBeNull();
    // ...and refusing it there must not have spent it at the real store.
    await expect(consumeHandoffToken(token, 'acme')).resolves.toEqual(CLAIMS);
  });

  it('refuses a forged ticket', async () => {
    await expect(consumeHandoffToken('not.a.token', 'acme')).resolves.toBeNull();
  });

  it('refuses a ticket whose row has expired', async () => {
    const token = await mintHandoffToken(CLAIMS);
    for (const row of rows.values()) row.expiresAt = new Date(Date.now() - 1000);
    await expect(consumeHandoffToken(token, 'acme')).resolves.toBeNull();
  });
});
