/*
 * Publishing: who may publish what, and what "published" is allowed to mean.
 *
 * The real service runs against an in-memory store that honours `where` the
 * way Postgres would, and against a fake provider that can be told to
 * succeed, fail or count its calls. What's under test is the part that would
 * actually hurt a merchant if it were wrong:
 *
 *   - store A cannot publish through store B's connection, or with store B's
 *     product, however it phrases the request;
 *   - a double-click posts once;
 *   - a failure at the platform never reports success, and keeps enough to
 *     retry;
 *   - a post never carries a token.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 9).toString('base64');

type Row = Record<string, unknown>;

const connections: Row[] = [];
const posts: Row[] = [];
let sequence = 0;

/* What the provider does on the next call, and what it saw. */
const provider = {
  calls: [] as { platformAccountId: string; message: string; imageUrls: string[]; accessToken: string }[],
  behaviour: 'ok' as 'ok' | 'token_invalid' | 'rate_limited' | 'slow',
};

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(expected as Row[]).some((clause) => matches(row, clause))) return false;
      continue;
    }
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const condition = expected as { not?: unknown; in?: unknown[]; lt?: Date; gt?: Date };
      if ('not' in condition && actual === condition.not) return false;
      if ('in' in condition && !condition.in!.includes(actual)) return false;
      if ('lt' in condition && !((actual as Date) < (condition.lt as Date))) return false;
      if ('gt' in condition && !((actual as Date) > (condition.gt as Date))) return false;
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
    if (value === true) out[key] = row[key];
    // A nested select (post.connection) — resolve the relation by id.
    else if (typeof value === 'object' && key === 'connection') {
      const connection = connections.find((c) => c.id === row.connectionId);
      out[key] = connection ? project(connection, (value as { select: Record<string, unknown> }).select) : null;
    }
  }
  return out;
}

function applyData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in (value as Row)) {
      row[key] = (Number(row[key]) || 0) + Number((value as { increment: number }).increment);
    } else {
      row[key] = value;
    }
  }
  row.updatedAt = new Date();
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    socialConnection: {
      findFirst: async ({ where, select }: { where?: Row; select?: Record<string, unknown> }) => {
        const row = connections.find((candidate) => matches(candidate, where));
        return row ? project(row, select) : null;
      },
      updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
        let count = 0;
        for (const row of connections) {
          if (matches(row, where)) {
            applyData(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    socialPost: {
      create: async ({ data, select }: { data: Row; select?: Record<string, unknown> }) => {
        /* The real table has UNIQUE (organizationId, idempotencyKey). Without
         * it here, a concurrency test would pass in vitest and fail in
         * Postgres — so the mock enforces it and raises Prisma's own code. */
        const clash = posts.some(
          (row) =>
            row.organizationId === data.organizationId && row.idempotencyKey === data.idempotencyKey,
        );
        if (clash) {
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
            meta: { target: ['organizationId', 'idempotencyKey'] },
          });
        }
        const row: Row = { id: `post_${++sequence}`, attempts: 0, createdAt: new Date(), updatedAt: new Date(), ...data };
        posts.push(row);
        return project(row, select);
      },
      findFirst: async ({ where, select }: { where?: Row; select?: Record<string, unknown> }) => {
        const row = posts.find((candidate) => matches(candidate, where));
        return row ? project(row, select) : null;
      },
      findFirstOrThrow: async ({ where, select }: { where?: Row; select?: Record<string, unknown> }) => {
        const row = posts.find((candidate) => matches(candidate, where));
        if (!row) throw new Error('not found');
        return project(row, select);
      },
      findMany: async ({ where, select }: { where?: Row; select?: Record<string, unknown> }) =>
        posts.filter((row) => matches(row, where)).map((row) => project(row, select)),
      count: async ({ where }: { where?: Row }) => posts.filter((row) => matches(row, where)).length,
      update: async ({ where, data, select }: { where: { id: string }; data: Row; select?: Record<string, unknown> }) => {
        const row = posts.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('not found');
        applyData(row, data);
        return project(row, select);
      },
      updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
        let count = 0;
        for (const row of posts) {
          if (matches(row, where)) {
            applyData(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
  },
}));

/* The provider seam. The real Meta client is never involved. */
vi.mock('./registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry')>();
  const { SocialProviderError } = await import('./types');

  return {
    ...actual,
    getProviderForPlatform: (platform: string) => ({
      publishRules: () =>
        platform === 'INSTAGRAM_BUSINESS'
          ? { imagesRequired: true, maxImages: 10, maxCaptionChars: 2200, supportsLinkInCaption: false }
          : { imagesRequired: false, maxImages: 1, maxCaptionChars: 63206, supportsLinkInCaption: true },
      publishPost: async (request: {
        platformAccountId: string;
        message: string;
        imageUrls: string[];
        accessToken: string;
      }) => {
        provider.calls.push(request);
        if (provider.behaviour === 'token_invalid') {
          throw new SocialProviderError('token_invalid', 'Session expired', '190/458');
        }
        if (provider.behaviour === 'rate_limited') {
          throw new SocialProviderError('rate_limited', 'Too many calls', '4');
        }
        if (provider.behaviour === 'slow') {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return { externalPostId: `ext_${provider.calls.length}`, externalUrl: 'https://facebook.example/post/1' };
      },
    }),
  };
});

/* Products come from the catalogue seam; stub it with two stores' products. */
vi.mock('./product-facts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./product-facts')>();
  return {
    ...actual,
    getProductFacts: async (organizationId: string, productId: string) => {
      const owner = productId.startsWith('a_') ? 'org_a' : 'org_b';
      if (owner !== organizationId) return null; // the tenant check, faithfully
      return {
        productId,
        name: 'Ankara Wrap Dress',
        description: 'A wrap dress.',
        shortDescription: null,
        categoryPath: ['Clothing'],
        brandName: null,
        priceLabel: '₦24,500',
        variantSummary: [],
        highlights: [],
        specs: [],
        tags: [],
        storeName: 'Store',
        storeDescription: null,
        productUrl: `https://shop.example.com/products/${productId}`,
        isPublished: true,
        images: [
          { id: `${productId}_img1`, url: `https://cdn.example.com/${productId}-1.jpg`, alt: null },
          { id: `${productId}_img2`, url: `https://cdn.example.com/${productId}-2.jpg`, alt: null },
        ],
      };
    },
  };
});

const { seal } = await import('./crypto');
const { publishPost, retryPost, listPosts, composeMessage } = await import('./publish');

const STORE_A = 'org_a';
const STORE_B = 'org_b';

function addConnection(id: string, organizationId: string, platform: string, status = 'ACTIVE') {
  connections.push({
    id,
    organizationId,
    platform,
    status,
    accountName: `${organizationId} account`,
    platformAccountId: `page_${id}`,
    accessTokenCipher: status === 'ACTIVE' ? seal(`TOKEN_${id}`) : '',
  });
}

function input(overrides: Partial<Parameters<typeof publishPost>[2]> = {}) {
  return {
    connectionId: 'conn_a',
    productId: 'a_product',
    imageIds: ['a_product_img1'],
    caption: 'A lovely wrap dress.',
    hashtags: ['#ankara'],
    idempotencyKey: `key_${Math.random()}`,
    ...overrides,
  };
}

beforeEach(() => {
  connections.length = 0;
  posts.length = 0;
  sequence = 0;
  provider.calls = [];
  provider.behaviour = 'ok';

  addConnection('conn_a', STORE_A, 'FACEBOOK_PAGE');
  addConnection('conn_b', STORE_B, 'FACEBOOK_PAGE');
  addConnection('conn_ig_a', STORE_A, 'INSTAGRAM_BUSINESS');
});

describe('store isolation', () => {
  it('publishes with its own connection and its own product', async () => {
    const result = await publishPost(STORE_A, 'user_a', input());
    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });

  it('refuses another store’s connection id', async () => {
    const result = await publishPost(STORE_A, 'user_a', input({ connectionId: 'conn_b' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('isn’t connected to this store');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses another store’s product id', async () => {
    const result = await publishPost(STORE_A, 'user_a', input({ productId: 'b_product' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('isn’t in this store’s catalogue');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses to retry another store’s post', async () => {
    const mine = await publishPost(STORE_A, 'user_a', input());
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;

    const stolen = await retryPost(STORE_B, mine.post.id);
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.reason).toContain('isn’t in this store');
  });

  it('lists only its own posts', async () => {
    await publishPost(STORE_A, 'user_a', input());
    await publishPost(STORE_B, 'user_b', input({ connectionId: 'conn_b', productId: 'b_product', imageIds: [] }));

    expect((await listPosts(STORE_A)).rows).toHaveLength(1);
    expect((await listPosts(STORE_B)).rows).toHaveLength(1);
  });

  it('drops image ids that belong to another product', async () => {
    const result = await publishPost(
      STORE_A,
      'user_a',
      input({ imageIds: ['b_product_img1', 'a_product_img1'] }),
    );
    expect(result.ok).toBe(true);
    // Facebook takes one image; only the legitimate one could be chosen.
    expect(provider.calls[0].imageUrls).toEqual(['https://cdn.example.com/a_product-1.jpg']);
  });
});

describe('connection state', () => {
  it('refuses to post through a disconnected account', async () => {
    connections.length = 0;
    addConnection('conn_a', STORE_A, 'FACEBOOK_PAGE', 'DISCONNECTED');

    const result = await publishPost(STORE_A, 'user_a', input());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('needs reconnecting');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses to post through an expired connection', async () => {
    connections.length = 0;
    addConnection('conn_a', STORE_A, 'FACEBOOK_PAGE', 'EXPIRED');

    const result = await publishPost(STORE_A, 'user_a', input());
    expect(result.ok).toBe(false);
    expect(provider.calls).toHaveLength(0);
  });

  it('requires an image for Instagram', async () => {
    const result = await publishPost(STORE_A, 'user_a', input({ connectionId: 'conn_ig_a', imageIds: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('at least one image');
    expect(provider.calls).toHaveLength(0);
  });

  it('requires a caption', async () => {
    const result = await publishPost(STORE_A, 'user_a', input({ caption: '   ' }));
    expect(result.ok).toBe(false);
    expect(provider.calls).toHaveLength(0);
  });
});

describe('duplicate protection', () => {
  it('a double-click publishes once', async () => {
    const key = 'one-composer-session';
    const [first, second] = await Promise.all([
      publishPost(STORE_A, 'user_a', input({ idempotencyKey: key })),
      publishPost(STORE_A, 'user_a', input({ idempotencyKey: key })),
    ]);

    // Exactly one reached the platform.
    expect(provider.calls).toHaveLength(1);
    // And exactly one row exists.
    expect(posts).toHaveLength(1);
    expect([first.ok, second.ok]).toContain(true);
  });

  it('re-submitting a published key returns the original post, not a second one', async () => {
    const key = 'same-key';
    const first = await publishPost(STORE_A, 'user_a', input({ idempotencyKey: key }));
    const again = await publishPost(STORE_A, 'user_a', input({ idempotencyKey: key }));

    expect(first.ok && again.ok).toBe(true);
    if (first.ok && again.ok) expect(again.post.id).toBe(first.post.id);
    expect(provider.calls).toHaveLength(1);
    expect(posts).toHaveLength(1);
  });

  it('a different composer session may post the same product again', async () => {
    await publishPost(STORE_A, 'user_a', input({ idempotencyKey: 'session-1' }));
    await publishPost(STORE_A, 'user_a', input({ idempotencyKey: 'session-2' }));

    expect(provider.calls).toHaveLength(2);
    expect(posts).toHaveLength(2);
  });

  it('will not re-publish a post that already succeeded', async () => {
    const first = await publishPost(STORE_A, 'user_a', input());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const retried = await retryPost(STORE_A, first.post.id);
    expect(retried.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });
});

describe('failure is never reported as success', () => {
  it('records a failed post as FAILED with a reason', async () => {
    provider.behaviour = 'rate_limited';

    const result = await publishPost(STORE_A, 'user_a', input());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.post?.status).toBe('FAILED');
    expect(result.post?.problem).toContain('limiting posts');
    expect(result.post?.publishedAt).toBeNull();
  });

  it('keeps everything needed to retry, and the retry succeeds', async () => {
    provider.behaviour = 'rate_limited';
    const failed = await publishPost(STORE_A, 'user_a', input());
    expect(failed.ok).toBe(false);
    if (failed.ok) return;

    // The caption, images and destination survived the failure.
    expect(failed.post?.caption).toBe('A lovely wrap dress.');
    expect(failed.post?.imageUrls).toHaveLength(1);

    provider.behaviour = 'ok';
    const retried = await retryPost(STORE_A, failed.post!.id);

    expect(retried.ok).toBe(true);
    if (retried.ok) {
      expect(retried.post.status).toBe('PUBLISHED');
      expect(retried.post.attempts).toBe(2);
    }
  });

  it('marks the connection revoked when the platform rejects the token', async () => {
    provider.behaviour = 'token_invalid';

    const result = await publishPost(STORE_A, 'user_a', input());
    expect(result.ok).toBe(false);

    const connection = connections.find((row) => row.id === 'conn_a');
    expect(connection?.status).toBe('REVOKED');
    expect(connection?.lastErrorCode).toBe('190/458');
  });

  it('does not revoke a connection over a transient failure', async () => {
    provider.behaviour = 'rate_limited';
    await publishPost(STORE_A, 'user_a', input());

    expect(connections.find((row) => row.id === 'conn_a')?.status).toBe('ACTIVE');
  });
});

describe('what actually gets sent', () => {
  it('appends the link on Facebook and the hashtags after it', async () => {
    await publishPost(STORE_A, 'user_a', input());
    const message = provider.calls[0].message;

    expect(message).toContain('A lovely wrap dress.');
    expect(message).toContain('https://shop.example.com/products/a_product');
    expect(message).toContain('#ankara');
  });

  it('leaves the link out on Instagram, where it would be dead text', async () => {
    await publishPost(
      STORE_A,
      'user_a',
      input({ connectionId: 'conn_ig_a', imageIds: ['a_product_img1', 'a_product_img2'] }),
    );

    const message = provider.calls[0].message;
    expect(message).not.toContain('https://shop.example.com');
    expect(message).toContain('#ankara');
    // Instagram takes the whole carousel.
    expect(provider.calls[0].imageUrls).toHaveLength(2);
  });

  it('truncates to the platform’s caption limit', () => {
    const rules = { imagesRequired: false, maxImages: 1, maxCaptionChars: 20, supportsLinkInCaption: true };
    expect(composeMessage('x'.repeat(100), [], null, rules)).toHaveLength(20);
  });
});

describe('tokens', () => {
  it('hands the provider a decrypted token but never stores one on the post', async () => {
    const result = await publishPost(STORE_A, 'user_a', input());
    expect(provider.calls[0].accessToken).toBe('TOKEN_conn_a');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(JSON.stringify(result.post)).not.toContain('TOKEN_conn_a');
    expect(Object.keys(posts[0])).not.toContain('accessTokenCipher');
  });
});
