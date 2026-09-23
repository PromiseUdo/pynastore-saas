/*
 * Post history: who can see which posts, and what a filter is allowed to do.
 *
 * The history page is a read surface over rows that belong to exactly one
 * store, so the things worth pinning down are:
 *
 *   - a filter can only ever NARROW what a store already sees. There is no
 *     parameter — status, platform, search, dates, product — that can reach
 *     another store's posts, because organizationId is applied by the
 *     service and never read from the params;
 *   - a post id from another store is a miss, not a leak, on read AND on
 *     delete;
 *   - a published post cannot be erased from the record;
 *   - nothing a caller receives carries a token.
 *
 * The in-memory store honours `where`, `skip`/`take`, `orderBy` and `count`
 * the way Postgres would, so pagination and filtering are exercised for real
 * rather than asserted about.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 11).toString('base64');

type Row = Record<string, unknown>;

const connections: Row[] = [];
const products: Row[] = [];
const posts: Row[] = [];
let sequence = 0;

/** The subset of Prisma's `where` this service actually builds. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;

  for (const [key, expected] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(expected as Row[]).some((clause) => matches(row, clause))) return false;
      continue;
    }

    const actual = row[key];

    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const condition = expected as {
        not?: unknown;
        in?: unknown[];
        gte?: Date;
        lte?: Date;
        contains?: string;
        mode?: string;
      };
      if ('not' in condition && actual === condition.not) return false;
      if ('in' in condition && !condition.in!.includes(actual)) return false;
      if ('gte' in condition && !(actual instanceof Date && actual >= condition.gte!)) return false;
      if ('lte' in condition && !(actual instanceof Date && actual <= condition.lte!)) return false;
      if ('contains' in condition) {
        const haystack = typeof actual === 'string' ? actual : '';
        const needle = condition.contains!;
        const hit =
          condition.mode === 'insensitive'
            ? haystack.toLowerCase().includes(needle.toLowerCase())
            : haystack.includes(needle);
        if (!hit) return false;
      }
      continue;
    }

    if (actual !== expected) return false;
  }
  return true;
}

function project(row: Row, select?: Record<string, unknown>): Row {
  if (!select) return { ...row };
  const out: Row = {};

  for (const [key, value] of Object.entries(select)) {
    if (value === true) {
      out[key] = row[key];
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;

    const nested = (value as { select?: Record<string, unknown>; take?: number }).select;

    if (key === 'connection') {
      const connection = connections.find((c) => c.id === row.connectionId);
      out[key] = connection ? project(connection, nested) : null;
    }
    if (key === 'inventoryItem') {
      const product = products.find((p) => p.id === row.inventoryItemId);
      out[key] = product ? project(product, nested) : null;
    }
    if (key === 'images') {
      const images = (row.images as Row[] | undefined) ?? [];
      const take = (value as { take?: number }).take ?? images.length;
      out[key] = images.slice(0, take).map((image) => project(image, nested));
    }
  }
  return out;
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    socialPost: {
      findMany: async ({
        where,
        select,
        skip = 0,
        take,
      }: {
        where?: Row;
        select?: Record<string, unknown>;
        skip?: number;
        take?: number;
      }) => {
        const found = posts
          .filter((row) => matches(row, where))
          // The service always orders createdAt desc.
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        const page = found.slice(skip, take === undefined ? undefined : skip + take);
        return page.map((row) => project(row, select));
      },
      count: async ({ where }: { where?: Row }) => posts.filter((row) => matches(row, where)).length,
      findFirst: async ({ where, select }: { where?: Row; select?: Record<string, unknown> }) => {
        const row = posts.find((candidate) => matches(candidate, where));
        return row ? project(row, select) : null;
      },
      deleteMany: async ({ where }: { where?: Row }) => {
        let count = 0;
        for (let i = posts.length - 1; i >= 0; i -= 1) {
          if (matches(posts[i], where)) {
            posts.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      },
      updateMany: async () => ({ count: 0 }),
    },
  },
}));

const { listPosts, getPost, discardPost } = await import('./publish');

const STORE_A = 'org_a';
const STORE_B = 'org_b';

function addConnection(id: string, organizationId: string, overrides: Row = {}) {
  connections.push({
    id,
    organizationId,
    accountName: 'Adire Studio',
    username: 'adirestudio',
    status: 'ACTIVE',
    /* Present on the real row. Nothing in the history path may select it —
     * the tests at the bottom prove it never comes back. */
    accessTokenCipher: 'v1.SEALED_TOKEN_MATERIAL',
    ...overrides,
  });
}

function addProduct(id: string, organizationId: string) {
  products.push({
    id,
    organizationId,
    images: [{ url: `https://cdn.example.com/${id}.jpg` }],
  });
}

function addPost(organizationId: string, overrides: Row = {}) {
  const id = `post_${++sequence}`;
  const row: Row = {
    id,
    organizationId,
    connectionId: 'conn_a',
    inventoryItemId: 'prod_a',
    platform: 'FACEBOOK_PAGE',
    status: 'PUBLISHED',
    accountName: 'Adire Studio',
    productName: 'Ankara Wrap Dress',
    productUrl: 'https://shop.example.com/products/dress',
    caption: 'A lovely wrap dress.',
    hashtags: ['#ankara'],
    imageUrls: ['https://cdn.example.com/1.jpg'],
    externalPostId: 'ext_1',
    externalUrl: 'https://facebook.com/post/1',
    errorCode: null,
    errorMessage: null,
    attempts: 1,
    createdAt: new Date('2026-09-10T10:00:00Z'),
    publishedAt: new Date('2026-09-10T10:00:05Z'),
    ...overrides,
  };
  posts.push(row);
  return row;
}

beforeEach(() => {
  connections.length = 0;
  products.length = 0;
  posts.length = 0;
  sequence = 0;

  addConnection('conn_a', STORE_A);
  addConnection('conn_b', STORE_B, { accountName: 'Other Shop', username: 'othershop' });
  addProduct('prod_a', STORE_A);
  addProduct('prod_b', STORE_B);
});

describe('tenant isolation', () => {
  it('lists only this store’s posts', async () => {
    addPost(STORE_A, { productName: 'Mine' });
    addPost(STORE_B, { connectionId: 'conn_b', inventoryItemId: 'prod_b', productName: 'Theirs' });

    const mine = await listPosts(STORE_A);
    expect(mine.rows.map((row) => row.productName)).toEqual(['Mine']);
    expect(mine.total).toBe(1);
    expect(mine.historySize).toBe(1);
  });

  it('does not return another store’s post by id', async () => {
    const theirs = addPost(STORE_B, { connectionId: 'conn_b', inventoryItemId: 'prod_b' });

    expect(await getPost(STORE_A, theirs.id as string)).toBeNull();
    // ...and the owner still sees it, so the miss is about the store, not the row.
    expect(await getPost(STORE_B, theirs.id as string)).not.toBeNull();
  });

  it('does not delete another store’s post', async () => {
    const theirs = addPost(STORE_B, { connectionId: 'conn_b', status: 'FAILED' });

    expect(await discardPost(STORE_A, theirs.id as string)).toBe(false);
    expect(posts).toHaveLength(1);
  });

  it('cannot be widened by any filter', async () => {
    addPost(STORE_B, {
      connectionId: 'conn_b',
      inventoryItemId: 'prod_b',
      productName: 'Theirs',
      status: 'FAILED',
      platform: 'INSTAGRAM_BUSINESS',
    });

    /* Every filter aimed squarely at the other store's row still returns
     * nothing, because organizationId is ANDed on by the service. */
    for (const params of [
      { q: 'Theirs' },
      { status: 'FAILED' as const },
      { platform: 'INSTAGRAM_BUSINESS' as const },
      { productId: 'prod_b' },
      { from: new Date('2020-01-01'), to: new Date('2030-01-01') },
    ]) {
      const result = await listPosts(STORE_A, params);
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
    }
  });

  it('reports an empty history rather than another store’s count', async () => {
    addPost(STORE_B, { connectionId: 'conn_b' });
    const result = await listPosts(STORE_A);
    expect(result.historySize).toBe(0);
  });
});

describe('filtering', () => {
  beforeEach(() => {
    addPost(STORE_A, { status: 'PUBLISHED', platform: 'FACEBOOK_PAGE', productName: 'Wrap Dress' });
    addPost(STORE_A, { status: 'FAILED', platform: 'INSTAGRAM_BUSINESS', productName: 'Head Wrap' });
    addPost(STORE_A, { status: 'DRAFT', platform: 'FACEBOOK_PAGE', productName: 'Kaftan' });
  });

  it('filters by status', async () => {
    const result = await listPosts(STORE_A, { status: 'FAILED' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('FAILED');
    // The unfiltered count stays honest.
    expect(result.historySize).toBe(3);
  });

  it('filters by platform', async () => {
    const result = await listPosts(STORE_A, { platform: 'FACEBOOK_PAGE' });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.platform === 'FACEBOOK_PAGE')).toBe(true);
  });

  it('combines filters', async () => {
    const result = await listPosts(STORE_A, { status: 'DRAFT', platform: 'FACEBOOK_PAGE' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productName).toBe('Kaftan');
  });

  it('filters by product', async () => {
    addPost(STORE_A, { inventoryItemId: 'prod_other', productName: 'Something else' });
    const result = await listPosts(STORE_A, { productId: 'prod_a' });
    expect(result.rows).toHaveLength(3);
  });

  it('filters by date range, inclusive of the whole end day', async () => {
    posts.length = 0;
    addPost(STORE_A, { createdAt: new Date('2026-09-01T09:00:00Z'), productName: 'September' });
    addPost(STORE_A, { createdAt: new Date('2026-08-01T09:00:00Z'), productName: 'August' });

    const result = await listPosts(STORE_A, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-30T23:59:59.999Z'),
    });
    expect(result.rows.map((row) => row.productName)).toEqual(['September']);
  });
});

describe('search', () => {
  beforeEach(() => {
    posts.length = 0;
    addPost(STORE_A, { productName: 'Ankara Wrap Dress', caption: 'Soft cotton.', accountName: 'Adire Studio' });
    addPost(STORE_A, { productName: 'Leather Tote', caption: 'Hand stitched in Kano.', accountName: 'Adire Shop' });
  });

  it('matches a product name, case-insensitively', async () => {
    const result = await listPosts(STORE_A, { q: 'ankara' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productName).toBe('Ankara Wrap Dress');
  });

  it('matches caption text', async () => {
    const result = await listPosts(STORE_A, { q: 'stitched' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productName).toBe('Leather Tote');
  });

  it('matches the account name', async () => {
    const result = await listPosts(STORE_A, { q: 'Adire Shop' });
    expect(result.rows).toHaveLength(1);
  });

  it('returns nothing rather than everything when nothing matches', async () => {
    const result = await listPosts(STORE_A, { q: 'zzzz' });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    // ...and still says the store has posts, so the UI can say "no results".
    expect(result.historySize).toBe(2);
  });
});

describe('pagination', () => {
  beforeEach(() => {
    posts.length = 0;
    for (let i = 0; i < 25; i += 1) {
      addPost(STORE_A, {
        productName: `Post ${i}`,
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
      });
    }
  });

  it('returns one page at a time, newest first', async () => {
    const first = await listPosts(STORE_A, { page: 1, perPage: 10 });

    expect(first.rows).toHaveLength(10);
    expect(first.total).toBe(25);
    expect(first.pageCount).toBe(3);
    expect(first.rows[0].productName).toBe('Post 24');
  });

  it('returns the rest on later pages, without overlap', async () => {
    const [first, second, third] = await Promise.all([
      listPosts(STORE_A, { page: 1, perPage: 10 }),
      listPosts(STORE_A, { page: 2, perPage: 10 }),
      listPosts(STORE_A, { page: 3, perPage: 10 }),
    ]);

    expect(third.rows).toHaveLength(5);
    const ids = [...first.rows, ...second.rows, ...third.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(25);
  });

  it('clamps a page past the end rather than erroring', async () => {
    const result = await listPosts(STORE_A, { page: 99, perPage: 10 });
    expect(result.page).toBe(3);
  });

  it('clamps an absurd perPage', async () => {
    expect((await listPosts(STORE_A, { perPage: 5_000 })).perPage).toBe(100);
    expect((await listPosts(STORE_A, { perPage: 1 })).perPage).toBe(5);
  });
});

describe('post detail', () => {
  it('returns the post with its account and product', async () => {
    const created = addPost(STORE_A);
    const post = await getPost(STORE_A, created.id as string);

    expect(post).toMatchObject({
      accountName: 'Adire Studio',
      accountUsername: 'adirestudio',
      accountStatus: 'ACTIVE',
      productId: 'prod_a',
      productImageUrl: 'https://cdn.example.com/prod_a.jpg',
      externalPostId: 'ext_1',
    });
  });

  it('survives a product that has since been deleted', async () => {
    const created = addPost(STORE_A, { inventoryItemId: null, productName: 'Gone' });
    const post = await getPost(STORE_A, created.id as string);

    expect(post?.productId).toBeNull();
    expect(post?.productImageUrl).toBeNull();
    // The snapshot is why history still reads sensibly.
    expect(post?.productName).toBe('Gone');
  });

  it('explains a failure without inventing one for a healthy post', async () => {
    const failed = addPost(STORE_A, {
      status: 'FAILED',
      errorCode: 'token_invalid',
      errorMessage: 'Session expired',
      publishedAt: null,
    });
    const post = await getPost(STORE_A, failed.id as string);

    expect(post?.problem).toContain('reconnecting');
    expect(post?.errorCode).toBe('token_invalid');

    const published = await getPost(STORE_A, addPost(STORE_A).id as string);
    expect(published?.problem).toBeNull();
  });

  it('reports an account that has since been disconnected', async () => {
    connections.length = 0;
    addConnection('conn_a', STORE_A, { status: 'REVOKED' });
    const created = addPost(STORE_A);

    expect((await getPost(STORE_A, created.id as string))?.accountStatus).toBe('REVOKED');
  });
});

describe('discarding', () => {
  it('removes a failed post', async () => {
    const failed = addPost(STORE_A, { status: 'FAILED' });
    expect(await discardPost(STORE_A, failed.id as string)).toBe(true);
    expect(posts).toHaveLength(0);
  });

  it('removes a draft', async () => {
    const draft = addPost(STORE_A, { status: 'DRAFT' });
    expect(await discardPost(STORE_A, draft.id as string)).toBe(true);
  });

  it('refuses to erase a published post from the record', async () => {
    const published = addPost(STORE_A, { status: 'PUBLISHED' });
    expect(await discardPost(STORE_A, published.id as string)).toBe(false);
    expect(posts).toHaveLength(1);
  });

  it('refuses to remove a post that is still going out', async () => {
    const publishing = addPost(STORE_A, { status: 'PUBLISHING' });
    expect(await discardPost(STORE_A, publishing.id as string)).toBe(false);
  });

  it('keeps a failed post visible in history until a person removes it', async () => {
    addPost(STORE_A, { status: 'FAILED', errorCode: 'rate_limited' });
    const result = await listPosts(STORE_A);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('FAILED');
  });
});

describe('nothing leaks', () => {
  it('returns no token anywhere in a list payload', async () => {
    addPost(STORE_A);
    const result = await listPosts(STORE_A);

    const payload = JSON.stringify(result);
    expect(payload).not.toContain('SEALED_TOKEN_MATERIAL');
    expect(payload).not.toContain('accessTokenCipher');
  });

  it('returns no token anywhere in a detail payload', async () => {
    const created = addPost(STORE_A);
    const post = await getPost(STORE_A, created.id as string);

    const payload = JSON.stringify(post);
    expect(payload).not.toContain('SEALED_TOKEN_MATERIAL');
    expect(payload).not.toContain('accessTokenCipher');
    expect(Object.keys(post!)).not.toContain('accessTokenCipher');
  });

  it('returns no organization id to the caller', async () => {
    const created = addPost(STORE_A);
    const post = await getPost(STORE_A, created.id as string);

    expect(Object.keys(post!)).not.toContain('organizationId');
    expect(JSON.stringify(post)).not.toContain(STORE_A);
  });
});
