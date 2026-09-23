// Social Commerce → post history, against the real DB with a mocked org context.
//
// lib/social/history.test.ts proves the query logic against an in-memory
// store. This proves the same guarantees end to end: real Postgres, real
// Prisma `where` clauses, real permission checks, and the server actions the
// dashboard actually calls.
//
// What it is here to catch: a permission gate that isn't applied, and any
// path by which one store's session reaches another store's posts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Social History', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  /* No real User row exists in this fixture, and AuditLog.userId is a real
   * foreign key — so null, as tests/settings-bank-accounts.test.ts does. */
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { getSocialPosts, getSocialPost, discardSocialPost, retrySocialPost } = await import(
  '@/features/social/posts'
);

const BOTH = [PERMISSIONS.SOCIAL_VIEW, PERMISSIONS.SOCIAL_MANAGE];

let otherOrgId = '';
let myConnectionId = '';
let otherConnectionId = '';
let myProductId = '';
let foreignPostId = '';
let foreignFailedPostId = '';

/** A post in a given store. Defaults to a published one. */
async function makePost(organizationId: string, connectionId: string, overrides: Record<string, unknown> = {}) {
  return prisma.socialPost.create({
    data: {
      organizationId,
      connectionId,
      platform: 'FACEBOOK_PAGE',
      status: 'PUBLISHED',
      accountName: 'Adire Studio',
      productName: 'Ankara Wrap Dress',
      caption: 'A lovely wrap dress.',
      hashtags: ['#ankara'],
      imageUrls: ['https://cdn.example.com/1.jpg'],
      externalPostId: 'ext_1',
      externalUrl: 'https://facebook.com/post/1',
      publishedAt: new Date(),
      idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
      ...overrides,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const org = await prisma.organization.create({
    data: { name: 'Social History', slug: `__test-social-${suffix}` },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;

  otherOrgId = (
    await prisma.organization.create({ data: { name: 'Other', slug: `__test-social-other-${suffix}` } })
  ).id;

  const connection = (data: { organizationId: string; platformAccountId: string; accountName: string }) =>
    prisma.socialConnection.create({
      data: {
        ...data,
        platform: 'FACEBOOK_PAGE',
        username: 'adirestudio',
        /* Deliberately recognisable: the assertions below prove it never
         * appears in anything a caller receives. */
        accessTokenCipher: 'v1.SEALED_TOKEN_MATERIAL',
        scopes: ['pages_show_list'],
      },
      select: { id: true },
    });

  myConnectionId = (
    await connection({ organizationId: org.id, platformAccountId: `page-${suffix}`, accountName: 'Adire Studio' })
  ).id;
  otherConnectionId = (
    await connection({ organizationId: otherOrgId, platformAccountId: `page-other-${suffix}`, accountName: 'Other Shop' })
  ).id;

  myProductId = (
    await prisma.inventoryItem.create({
      data: { organizationId: org.id, sku: `SKU-${suffix}`, name: 'Ankara Wrap Dress' },
      select: { id: true },
    })
  ).id;

  foreignPostId = (await makePost(otherOrgId, otherConnectionId, { productName: 'Their Product' })).id;
  foreignFailedPostId = (
    await makePost(otherOrgId, otherConnectionId, {
      status: 'FAILED',
      publishedAt: null,
      externalPostId: null,
      externalUrl: null,
      errorCode: 'rate_limited',
      errorMessage: 'Too many calls',
    })
  ).id;
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.socialPost.deleteMany({ where: { organizationId } });
    await prisma.socialConnection.deleteMany({ where: { organizationId } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

beforeEach(async () => {
  ctx.membership.role.permissions = [...BOTH];
  await prisma.socialPost.deleteMany({ where: { organizationId: ctx.organization.id } });
});

describe('authorization', () => {
  it('refuses the history without social.view', async () => {
    ctx.membership.role.permissions = [];
    const result = await getSocialPosts();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('permission');
  });

  it('refuses a post detail without social.view', async () => {
    const post = await makePost(ctx.organization.id, myConnectionId);
    ctx.membership.role.permissions = [];

    const result = await getSocialPost(post.id);
    expect(result.success).toBe(false);
  });

  it('allows viewing with social.view alone', async () => {
    await makePost(ctx.organization.id, myConnectionId);
    ctx.membership.role.permissions = [PERMISSIONS.SOCIAL_VIEW];

    const result = await getSocialPosts();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rows).toHaveLength(1);
  });

  it('refuses to discard without social.manage, even with social.view', async () => {
    const post = await makePost(ctx.organization.id, myConnectionId, { status: 'FAILED', publishedAt: null });
    ctx.membership.role.permissions = [PERMISSIONS.SOCIAL_VIEW];

    const result = await discardSocialPost(post.id);
    expect(result.success).toBe(false);

    // ...and the row is still there.
    expect(await prisma.socialPost.count({ where: { id: post.id } })).toBe(1);
  });

  it('refuses to retry without social.manage', async () => {
    const post = await makePost(ctx.organization.id, myConnectionId, { status: 'FAILED', publishedAt: null });
    ctx.membership.role.permissions = [PERMISSIONS.SOCIAL_VIEW];

    const result = await retrySocialPost(post.id);
    expect(result.success).toBe(false);

    const after = await prisma.socialPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe('FAILED');
  });
});

describe('tenant isolation, against the database', () => {
  it('lists only this store’s posts', async () => {
    await makePost(ctx.organization.id, myConnectionId, { productName: 'Mine' });

    const result = await getSocialPosts();
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.rows.map((row) => row.productName)).toEqual(['Mine']);
    expect(result.data.total).toBe(1);
  });

  it('will not open another store’s post', async () => {
    const result = await getSocialPost(foreignPostId);

    expect(result.success).toBe(false);
    // Same words as a post that never existed — no confirmation it's real.
    if (!result.success) expect(result.error).toBe('Post not found');
  });

  it('will not discard another store’s failed post', async () => {
    const result = await discardSocialPost(foreignFailedPostId);
    expect(result.success).toBe(false);

    expect(await prisma.socialPost.count({ where: { id: foreignFailedPostId } })).toBe(1);
  });

  it('will not retry another store’s post', async () => {
    const result = await retrySocialPost(foreignFailedPostId);
    expect(result.success).toBe(false);

    const after = await prisma.socialPost.findUniqueOrThrow({ where: { id: foreignFailedPostId } });
    expect(after.status).toBe('FAILED');
    // Nothing was attempted on their behalf.
    expect(after.attempts).toBe(0);
  });

  it('cannot be widened by a filter aimed at the other store', async () => {
    for (const params of [
      { q: 'Their Product' },
      { status: 'FAILED' as const },
      { platform: 'FACEBOOK_PAGE' as const },
      { from: new Date('2020-01-01'), to: new Date('2030-01-01') },
    ]) {
      const result = await getSocialPosts(params);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.rows).toEqual([]);
    }
  });
});

describe('filtering and search, against the database', () => {
  beforeEach(async () => {
    await makePost(ctx.organization.id, myConnectionId, {
      productName: 'Wrap Dress',
      caption: 'Soft cotton Ankara.',
      platform: 'FACEBOOK_PAGE',
      status: 'PUBLISHED',
      inventoryItemId: myProductId,
    });
    await makePost(ctx.organization.id, myConnectionId, {
      productName: 'Head Wrap',
      caption: 'Hand dyed in Abeokuta.',
      platform: 'INSTAGRAM_BUSINESS',
      status: 'FAILED',
      publishedAt: null,
      errorCode: 'token_invalid',
      errorMessage: 'Session expired',
    });
  });

  it('filters by status', async () => {
    const result = await getSocialPosts({ status: 'FAILED' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.rows[0].productName).toBe('Head Wrap');
      expect(result.data.historySize).toBe(2);
    }
  });

  it('filters by platform', async () => {
    const result = await getSocialPosts({ platform: 'INSTAGRAM_BUSINESS' });
    if (result.success) expect(result.data.rows).toHaveLength(1);
  });

  it('searches captions case-insensitively', async () => {
    const result = await getSocialPosts({ q: 'abeokuta' });
    if (result.success) {
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.rows[0].productName).toBe('Head Wrap');
    }
  });

  it('filters by product', async () => {
    const result = await getSocialPosts({ productId: myProductId });
    if (result.success) {
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.rows[0].productName).toBe('Wrap Dress');
    }
  });

  it('keeps a failed post visible in the default view', async () => {
    const result = await getSocialPosts();
    if (result.success) {
      expect(result.data.rows.map((row) => row.status).sort()).toEqual(['FAILED', 'PUBLISHED']);
    }
  });
});

describe('post detail', () => {
  it('returns the post with its account and product', async () => {
    const post = await makePost(ctx.organization.id, myConnectionId, { inventoryItemId: myProductId });

    const result = await getSocialPost(post.id);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toMatchObject({
      accountName: 'Adire Studio',
      accountUsername: 'adirestudio',
      accountStatus: 'ACTIVE',
      productId: myProductId,
      externalPostId: 'ext_1',
    });
  });

  it('explains a failure in plain words', async () => {
    const post = await makePost(ctx.organization.id, myConnectionId, {
      status: 'FAILED',
      publishedAt: null,
      errorCode: 'token_invalid',
      errorMessage: 'Session expired',
    });

    const result = await getSocialPost(post.id);
    if (result.success) {
      expect(result.data.problem).toContain('reconnecting');
      expect(result.data.errorCode).toBe('token_invalid');
    }
  });
});

describe('discarding', () => {
  it('removes a failed post and writes an audit entry', async () => {
    const post = await makePost(ctx.organization.id, myConnectionId, { status: 'FAILED', publishedAt: null });

    const result = await discardSocialPost(post.id);
    expect(result.success).toBe(true);
    expect(await prisma.socialPost.count({ where: { id: post.id } })).toBe(0);

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: ctx.organization.id, entityId: post.id, action: 'social.post.discarded' },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses to erase a published post from the record', async () => {
    const post = await makePost(ctx.organization.id, myConnectionId);

    const result = await discardSocialPost(post.id);
    expect(result.success).toBe(false);
    expect(await prisma.socialPost.count({ where: { id: post.id } })).toBe(1);
  });
});

describe('nothing leaks to the caller', () => {
  it('returns no token or organization id in a list payload', async () => {
    await makePost(ctx.organization.id, myConnectionId);

    const result = await getSocialPosts();
    const payload = JSON.stringify(result);

    expect(payload).not.toContain('SEALED_TOKEN_MATERIAL');
    expect(payload).not.toContain('accessTokenCipher');
    expect(payload).not.toContain(ctx.organization.id);
  });

  it('returns no token or organization id in a detail payload', async () => {
    const post = await makePost(ctx.organization.id, myConnectionId, { inventoryItemId: myProductId });

    const result = await getSocialPost(post.id);
    const payload = JSON.stringify(result);

    expect(payload).not.toContain('SEALED_TOKEN_MATERIAL');
    expect(payload).not.toContain('accessTokenCipher');
    expect(payload).not.toContain(ctx.organization.id);
  });
});
