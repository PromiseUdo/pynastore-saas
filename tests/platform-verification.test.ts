// The platform console's verification queue (ROADMAP 10.8 / 11.1 / 11.3),
// against the real DB. The session, the merchant context, email and the
// Cloudinary config are mocked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/auth', () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));

// For the merchant's own activity log at the end.
const ctx = vi.hoisted(() => ({
  organization: { id: '', name: '', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] }, warehouseIds: [] },
  userId: '',
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const emails = vi.hoisted(() => [] as { to: string; outcome: string; reason?: string | null; setupUrl: string }[]);
vi.mock('@/lib/email', () => ({
  sendPaymentVerificationResultEmail: async (payload: { to: string; outcome: string; reason?: string | null; setupUrl: string }) => {
    emails.push(payload);
  },
}));
// Paystack: approval now creates the subaccount (10.3). Never the real API in tests.
const paystack = vi.hoisted(() => ({ created: [] as { businessName: string; metadata: Record<string, string> }[] }));
vi.mock('@/lib/payments/paystack', () => ({
  isPaystackConfigured: () => true,
  paystackKeyMode: () => 'test' as const,
  PaystackError: class PaystackError extends Error {
    constructor(message: string, readonly httpStatus: number) {
      super(message);
    }
  },
  createSubaccount: async (input: { businessName: string; metadata: Record<string, string> }) => {
    paystack.created.push(input);
    return { code: `ACCT_test_${paystack.created.length}_${Date.now()}`, active: true, isVerified: false, accountName: null, metadata: input.metadata };
  },
  fetchSubaccount: async () => null,
  findSubaccountsByMetadata: async () => [],
}));
vi.mock('@/lib/cloudinary/config', () => ({
  getCloudinaryConfig: () => ({ cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' }),
}));

const {
  listVerificationQueue,
  getVerificationCase,
  getCaseDocumentUrl,
  approveVerification,
  rejectVerification,
} = await import('@/features/platform/verification');
const { getOnlinePaymentReadiness } = await import('@/lib/payments/online-readiness');
const { listActivity } = await import('@/features/settings/activity');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let staffId = '';
let merchantId = '';
const orgs: Record<'older' | 'newer' | 'draft', string> = { older: '', newer: '', draft: '' };
let olderDocId = '';

async function makeMerchant(name: string, status: 'PENDING' | 'UNVERIFIED', submittedAt: Date | null) {
  const org = await prisma.organization.create({ data: { name, slug: `__test-verif-${name.toLowerCase()}-${suffix}` } });
  const account = await prisma.merchantPaymentAccount.create({
    data: {
      organizationId: org.id,
      businessType: 'INDIVIDUAL',
      businessName: `${name} Store`,
      idType: 'NIN',
      settlementBankCode: '058',
      settlementBankName: 'Guaranty Trust Bank',
      settlementAccountNumber: '0123456789',
      settlementAccountName: `${name.toUpperCase()} STORE`,
      contactName: name,
      contactEmail: `${name.toLowerCase()}-${suffix}@example.com`,
      contactPhone: '+2348031234567',
      verificationStatus: status,
      setupStatus: status === 'PENDING' ? 'AWAITING_VERIFICATION' : 'NOT_STARTED',
      submittedAt,
    },
  });
  const doc = await prisma.merchantVerificationDocument.create({
    data: {
      organizationId: org.id,
      accountId: account.id,
      kind: 'ID_DOCUMENT',
      publicId: `mansaas/${org.id}/verification/id-${suffix}`,
      format: 'pdf',
      bytes: 1000,
      fileName: 'id.pdf',
    },
  });
  return { orgId: org.id, docId: doc.id };
}

beforeAll(async () => {
  staffId = (await prisma.user.create({ data: { name: 'Staff Member', email: `staff-${suffix}@example.com`, isPlatformStaff: true } })).id;
  merchantId = (await prisma.user.create({ data: { name: 'Plain Merchant', email: `merchant-${suffix}@example.com` } })).id;

  const older = await makeMerchant('Older', 'PENDING', new Date(Date.now() - 3 * 86_400_000));
  const newer = await makeMerchant('Newer', 'PENDING', new Date(Date.now() - 86_400_000));
  const draft = await makeMerchant('Draft', 'UNVERIFIED', null);
  orgs.older = older.orgId;
  orgs.newer = newer.orgId;
  orgs.draft = draft.orgId;
  olderDocId = older.docId;
});

afterAll(async () => {
  for (const organizationId of Object.values(orgs)) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [staffId, merchantId] } } });
});

describe('platform console — who may use it', () => {
  it('refuses everything to someone who isn’t platform staff, and to nobody signed in', async () => {
    for (const userId of [merchantId, '']) {
      session.userId = userId;
      expect(await listVerificationQueue({})).toMatchObject({ success: false, error: expect.stringMatching(/platform staff/) });
      expect(await getVerificationCase(orgs.older)).toMatchObject({ success: false });
      expect(await getCaseDocumentUrl(orgs.older, olderDocId)).toMatchObject({ success: false });
      expect(await approveVerification(orgs.older)).toMatchObject({ success: false });
      expect(await rejectVerification(orgs.older, 'This is a long enough reason.')).toMatchObject({ success: false });
    }
    const untouched = await prisma.merchantPaymentAccount.findUniqueOrThrow({ where: { organizationId: orgs.older } });
    expect(untouched.verificationStatus).toBe('PENDING');
  });

  it('stops working the moment the flag is taken away', async () => {
    session.userId = staffId;
    expect((await listVerificationQueue({})).success).toBe(true);
    await prisma.user.update({ where: { id: staffId }, data: { isPlatformStaff: false } });
    try {
      expect((await listVerificationQueue({})).success).toBe(false);
    } finally {
      await prisma.user.update({ where: { id: staffId }, data: { isPlatformStaff: true } });
    }
  });
});

describe('platform console — the queue', () => {
  it('lists what’s waiting, oldest first, and never a setup nobody submitted', async () => {
    session.userId = staffId;
    const result = await listVerificationQueue({ q: suffix });
    // Search by web address narrows to this test's merchants.
    expect(result.success && result.data.rows.map((r) => r.organizationId)).toEqual([orgs.older, orgs.newer]);

    const all = await listVerificationQueue({ status: 'ALL', q: suffix });
    expect(all.success && all.data.rows.map((r) => r.organizationId)).not.toContain(orgs.draft);
    expect(result.success && result.data.counts.PENDING).toBeGreaterThanOrEqual(2);
  });

  it('shows one business with its documents behind a signed, expiring link', async () => {
    session.userId = staffId;
    const found = await getVerificationCase(orgs.older);
    expect(found.success && found.data).toMatchObject({
      organization: { id: orgs.older },
      account: { businessName: 'Older Store', settlementAccountName: 'OLDER STORE', verificationStatus: 'PENDING' },
      documents: [expect.objectContaining({ id: olderDocId, kind: 'ID_DOCUMENT' })],
    });

    const link = await getCaseDocumentUrl(orgs.older, olderDocId);
    const url = link.success ? new URL(link.data.url) : null;
    expect(url?.searchParams.get('type')).toBe('private');
    expect(url?.searchParams.get('expires_at')).toBeTruthy();

    // A document id only opens under the business it belongs to.
    expect(await getCaseDocumentUrl(orgs.newer, olderDocId)).toMatchObject({ success: false });
    expect(await getVerificationCase('no-such-org')).toEqual({ success: true, data: null });
  });
});

describe('platform console — deciding', () => {
  it('approves once, and approving creates the payout subaccount (10.3)', async () => {
    session.userId = staffId;
    emails.length = 0;
    paystack.created.length = 0;
    expect(await approveVerification(orgs.older)).toEqual({ success: true, data: { payouts: 'created' } });

    const approved = await prisma.merchantPaymentAccount.findUniqueOrThrow({ where: { organizationId: orgs.older } });
    expect(approved).toMatchObject({
      verificationStatus: 'VERIFIED',
      reviewedById: staffId,
      setupStatus: 'ACTIVE',
      paystackSubaccountCode: expect.stringMatching(/^ACCT_test_/),
    });
    expect(paystack.created).toEqual([expect.objectContaining({ businessName: 'Older Store', metadata: expect.objectContaining({ organizationId: orgs.older }) })]);
    expect(await getOnlinePaymentReadiness(orgs.older)).toEqual({ ready: true, blocker: null });

    expect(emails).toEqual([
      expect.objectContaining({
        to: `older-${suffix}@example.com`,
        outcome: 'approved',
        payoutsReady: true,
        setupUrl: expect.stringContaining('/settings/payments/online'),
      }),
    ]);

    // Deciding again does nothing — it isn't waiting any more.
    expect(await approveVerification(orgs.older)).toMatchObject({ success: false, error: expect.stringMatching(/decided/) });
    expect(await rejectVerification(orgs.older, 'Too late to send this one back.')).toMatchObject({ success: false });
    expect(emails).toHaveLength(1);
    expect(paystack.created).toHaveLength(1);
  });

  it('sends back only with a real reason, which the merchant is told word for word', async () => {
    session.userId = staffId;
    emails.length = 0;
    expect(await rejectVerification(orgs.newer, 'no')).toMatchObject({ success: false, fieldError: expect.any(String) });
    expect((await prisma.merchantPaymentAccount.findUniqueOrThrow({ where: { organizationId: orgs.newer } })).verificationStatus).toBe(
      'PENDING',
    );

    const reason = 'The ID photo is too blurred to read. Upload a clearer photo of the front.';
    expect(await rejectVerification(orgs.newer, `  ${reason}  `)).toEqual({ success: true, data: undefined });
    const back = await prisma.merchantPaymentAccount.findUniqueOrThrow({ where: { organizationId: orgs.newer } });
    expect(back).toMatchObject({ verificationStatus: 'REJECTED', setupStatus: 'NOT_STARTED', rejectionReason: reason });
    expect(await getOnlinePaymentReadiness(orgs.newer)).toEqual({ ready: false, blocker: 'rejected' });
    expect(emails).toEqual([expect.objectContaining({ outcome: 'rejected', reason })]);
  });

  it('leaves each decision on the merchant’s own log, as the platform — not the staff member’s name', async () => {
    ctx.organization.id = orgs.newer;
    ctx.userId = merchantId;
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
    const log = await listActivity({});
    const row = log.success ? log.data.rows.find((r) => r.action === 'platform.verification.rejected') : undefined;
    expect(row).toBeDefined();
    expect(row?.actorName).toBeNull();
    expect(row?.actorEmail).toBeNull();
  });
});
