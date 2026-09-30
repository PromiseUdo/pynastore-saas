// "Get paid online" (ROADMAP 10.2), against the real DB with a mocked org
// context, a mocked Paystack and a fake Cloudinary config.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Ada Fabrics', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] }, warehouseIds: [] },
  userId: '',
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

// Paystack: two banks, one known account, and a switch for an outage.
const paystack = vi.hoisted(() => ({
  names: { '0123456789': 'ADA FABRICS LTD' } as Record<string, string>,
  down: false,
}));
vi.mock('@/lib/payments/paystack', () => ({
  listNigerianBanks: async () => [
    { code: '058', name: 'Guaranty Trust Bank' },
    { code: '044', name: 'Access Bank' },
  ],
  resolveAccountName: async (_bank: string, account: string) => {
    if (paystack.down) throw new Error('network');
    return paystack.names[account] ?? null;
  },
}));

vi.mock('@/lib/cloudinary/config', () => ({
  getCloudinaryConfig: () => ({ cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' }),
}));
const destroyed = vi.hoisted(() => [] as { publicId: string; type?: string }[]);
vi.mock('@/lib/cloudinary/sign', async (original) => ({
  ...(await original<typeof import('@/lib/cloudinary/sign')>()),
  destroyAsset: async (publicId: string, options: { type?: string } = {}) => {
    destroyed.push({ publicId, type: options.type });
  },
}));

const {
  getPaymentSetup,
  listSettlementBanks,
  lookupSettlementAccount,
  getVerificationUploadSignature,
  getVerificationDocumentUrl,
  savePaymentSetup,
  withdrawPaymentSetup,
} = await import('@/features/settings/payment-setup');

let otherOrgId = '';
let userId = '';
const doc = (kind: 'CAC_CERTIFICATE' | 'ID_DOCUMENT' | 'PROOF_OF_ADDRESS', name: string, orgId = ctx.organization.id) => ({
  kind,
  publicId: `mansaas/${orgId}/verification/${name}`,
  format: 'pdf',
  bytes: 120_000,
  fileName: `${name}.pdf`,
});

const complete = () => ({
  businessType: 'COMPANY' as const,
  businessName: 'Ada Fabrics',
  cacNumber: 'rc 1234567',
  registeredName: 'Ada Fabrics Limited',
  idType: 'NIN' as const,
  settlementBankCode: '058',
  settlementAccountNumber: '012 345 6789',
  contactName: 'Ada Obi',
  contactEmail: 'ada@example.com',
  contactPhone: '0803 123 4567',
  documents: [doc('CAC_CERTIFICATE', 'cac'), doc('ID_DOCUMENT', 'id-front'), doc('PROOF_OF_ADDRESS', 'bill')],
});

const EDIT = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: 'Ada Fabrics', slug: `__test-paysetup-${suffix}`, supportPhone: '08031234567' },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = EDIT;
  userId = (await prisma.user.create({ data: { name: 'Ada Obi', email: `ada-${suffix}@example.com` } })).id;
  ctx.userId = userId;

  otherOrgId = (await prisma.organization.create({ data: { name: 'Other', slug: `__test-paysetup-other-${suffix}` } })).id;
  await prisma.merchantPaymentAccount.create({
    data: { organizationId: otherOrgId, businessName: 'Other Shop', verificationStatus: 'PENDING' },
  });
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  await prisma.user.delete({ where: { id: userId } });
});

describe('getting paid online — setup', () => {
  it('starts not set up, prefilled from the business’s own records', async () => {
    const view = await getPaymentSetup();
    expect(view.success && view.data.account).toBeNull();
    expect(view.success && view.data.prefill).toMatchObject({
      businessName: 'Ada Fabrics',
      contactName: 'Ada Obi',
      contactPhone: '08031234567',
    });
  });

  it('lists Paystack’s banks and looks up the name on an account', async () => {
    expect(await listSettlementBanks()).toMatchObject({ success: true, data: expect.arrayContaining([{ code: '058', name: 'Guaranty Trust Bank' }]) });
    expect(await lookupSettlementAccount({ bankCode: '058', accountNumber: '012 345 6789' })).toEqual({
      success: true,
      data: { accountName: 'ADA FABRICS LTD' },
    });
    expect(await lookupSettlementAccount({ bankCode: '058', accountNumber: '9999999999' })).toMatchObject({
      success: false,
      fieldErrors: { settlementAccountNumber: expect.stringMatching(/couldn’t find/) },
    });
    // A bank Paystack doesn't list is refused, not guessed at.
    expect(await lookupSettlementAccount({ bankCode: '000014', accountNumber: '0123456789' })).toMatchObject({
      fieldErrors: { settlementBankCode: 'Choose your bank' },
    });
  });

  it('says Paystack is unreachable rather than that the account is wrong', async () => {
    paystack.down = true;
    try {
      const result = await lookupSettlementAccount({ bankCode: '058', accountNumber: '0123456789' });
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/couldn’t reach/) });
      expect('fieldErrors' in result).toBe(false);
    } finally {
      paystack.down = false;
    }
  });

  it('saves a partial draft, but nothing in it may be wrong', async () => {
    const bad = await savePaymentSetup(
      { businessType: 'COMPANY', cacNumber: 'BN 999', contactPhone: '12345', contactEmail: 'not-an-email' },
      'draft',
    );
    expect(bad).toMatchObject({
      success: false,
      fieldErrors: {
        cacNumber: expect.stringMatching(/RC/),
        contactPhone: expect.any(String),
        contactEmail: expect.any(String),
      },
    });
    expect(await prisma.merchantPaymentAccount.count({ where: { organizationId: ctx.organization.id } })).toBe(0);

    const ok = await savePaymentSetup({ businessType: 'COMPANY', businessName: 'Ada Fabrics', cacNumber: 'rc-1234567' }, 'draft');
    expect(ok).toEqual({ success: true, data: { submitted: false } });
    const saved = await prisma.merchantPaymentAccount.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } });
    expect(saved).toMatchObject({ cacNumber: 'RC1234567', verificationStatus: 'UNVERIFIED', setupStatus: 'NOT_STARTED' });
  });

  it('refuses to submit until every step is done, and says which', async () => {
    const result = await savePaymentSetup({ businessType: 'COMPANY', businessName: 'Ada Fabrics' }, 'submit');
    expect(result.success).toBe(false);
    const fields = result.success === false && 'fieldErrors' in result ? Object.keys(result.fieldErrors) : [];
    expect(fields).toEqual(
      expect.arrayContaining([
        'cacNumber',
        'registeredName',
        'idType',
        'settlementBankCode',
        'documents.CAC_CERTIFICATE',
        'documents.ID_DOCUMENT',
        'documents.PROOF_OF_ADDRESS',
      ]),
    );
    const saved = await prisma.merchantPaymentAccount.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } });
    expect(saved.verificationStatus).toBe('UNVERIFIED');
  });

  it('never attaches another store’s document, or a file type we don’t take', async () => {
    const foreign = await savePaymentSetup(
      { ...complete(), documents: [doc('ID_DOCUMENT', 'stolen', otherOrgId)] },
      'draft',
    );
    expect(foreign).toMatchObject({ fieldErrors: { 'documents.ID_DOCUMENT': expect.any(String) } });

    const exe = await savePaymentSetup(
      { ...complete(), documents: [{ ...doc('ID_DOCUMENT', 'virus'), format: 'exe' }] },
      'draft',
    );
    expect(exe).toMatchObject({ fieldErrors: { 'documents.ID_DOCUMENT': expect.any(String) } });
  });

  it('submits a complete setup for review, with the name Paystack gave — not the browser’s', async () => {
    const result = await savePaymentSetup(
      { ...complete(), settlementAccountName: 'Somebody Else', paystackSecretKey: 'sk_live_x' } as never,
      'submit',
    );
    expect(result).toEqual({ success: true, data: { submitted: true } });

    const saved = await prisma.merchantPaymentAccount.findUniqueOrThrow({
      where: { organizationId: ctx.organization.id },
      include: { documents: true },
    });
    expect(saved).toMatchObject({
      verificationStatus: 'PENDING',
      setupStatus: 'AWAITING_VERIFICATION',
      settlementBankName: 'Guaranty Trust Bank',
      settlementAccountNumber: '0123456789',
      settlementAccountName: 'ADA FABRICS LTD',
      contactPhone: '+2348031234567',
      submittedById: userId,
      paystackSubaccountCode: null,
    });
    expect(saved.documents.map((d) => d.kind).sort()).toEqual(['CAC_CERTIFICATE', 'ID_DOCUMENT', 'PROOF_OF_ADDRESS']);
    expect(JSON.stringify(saved)).not.toContain('sk_live');

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: ctx.organization.id, action: 'settings.payment_setup.submitted' },
    });
    expect(audit).not.toBeNull();
  });

  it('can’t be changed while it’s being checked — not the details, not the files', async () => {
    expect(await savePaymentSetup(complete(), 'draft')).toMatchObject({ success: false, error: expect.stringMatching(/team/) });
    expect(await getVerificationUploadSignature()).toMatchObject({ success: false });
  });

  it('opens a document through a signed, expiring link — only this store’s', async () => {
    const own = await getVerificationDocumentUrl({ publicId: `mansaas/${ctx.organization.id}/verification/id-front`, format: 'pdf' });
    expect(own.success).toBe(true);
    const url = own.success ? new URL(own.data.url) : null;
    expect(url?.pathname).toBe('/v1_1/demo/image/download');
    expect(url?.searchParams.get('type')).toBe('private');
    expect(url?.searchParams.get('signature')).toBeTruthy();

    expect(
      await getVerificationDocumentUrl({ publicId: `mansaas/${otherOrgId}/verification/id-front`, format: 'pdf' }),
    ).toMatchObject({ success: false });
  });

  it('can be taken back out of review, edited, and a removed document is deleted from storage', async () => {
    expect((await withdrawPaymentSetup()).success).toBe(true);
    const back = await prisma.merchantPaymentAccount.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } });
    expect(back).toMatchObject({ verificationStatus: 'UNVERIFIED', setupStatus: 'NOT_STARTED', submittedAt: null });
    expect(await withdrawPaymentSetup()).toMatchObject({ success: false });

    const signature = await getVerificationUploadSignature();
    expect(signature.success && signature.data.fields).toMatchObject({
      type: 'private',
      folder: `mansaas/${ctx.organization.id}/verification`,
    });

    // Now an individual: no CAC at all, and the old address proof swapped.
    destroyed.length = 0;
    const result = await savePaymentSetup(
      {
        ...complete(),
        businessType: 'INDIVIDUAL',
        documents: [doc('ID_DOCUMENT', 'id-front'), doc('PROOF_OF_ADDRESS', 'bill-2'), doc('CAC_CERTIFICATE', 'cac')],
      },
      'draft',
    );
    expect(result.success).toBe(true);
    const saved = await prisma.merchantPaymentAccount.findUniqueOrThrow({
      where: { organizationId: ctx.organization.id },
      include: { documents: true },
    });
    expect(saved).toMatchObject({ businessType: 'INDIVIDUAL', cacNumber: null, registeredName: null });
    expect(saved.documents.map((d) => d.fileName).sort()).toEqual(['bill-2.pdf', 'id-front.pdf']);
    expect(destroyed).toEqual(
      expect.arrayContaining([
        { publicId: `mansaas/${ctx.organization.id}/verification/bill`, type: 'private' },
        { publicId: `mansaas/${ctx.organization.id}/verification/cac`, type: 'private' },
      ]),
    );
  });

  it('lets someone who can only view see the setup but not change it', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
    try {
      expect((await getPaymentSetup()).success).toBe(true);
      expect(await savePaymentSetup(complete(), 'draft')).toMatchObject({ success: false, error: expect.stringMatching(/permission/i) });
      expect(await listSettlementBanks()).toMatchObject({ success: false });
      expect(await getVerificationUploadSignature()).toMatchObject({ success: false });
      expect(
        await getVerificationDocumentUrl({ publicId: `mansaas/${ctx.organization.id}/verification/id-front`, format: 'pdf' }),
      ).toMatchObject({ success: false });
    } finally {
      ctx.membership.role.permissions = EDIT;
    }
  });

  it('never reads or touches another store’s setup', async () => {
    const view = await getPaymentSetup();
    expect(view.success && view.data.account?.businessName).toBe('Ada Fabrics');
    const other = await prisma.merchantPaymentAccount.findUniqueOrThrow({ where: { organizationId: otherOrgId } });
    expect(other).toMatchObject({ businessName: 'Other Shop', verificationStatus: 'PENDING' });
  });
});
