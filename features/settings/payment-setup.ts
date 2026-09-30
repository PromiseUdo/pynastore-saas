'use server';

/*
 * features/settings/payment-setup.ts
 *
 * "Get paid online" (ROADMAP 10.2): the merchant tells us about their
 * business, proves who they are, and names the bank account online payments
 * should settle to. Submitting sends it to OUR review (10.8) — nothing is sent
 * to Paystack here. The subaccount is created only after platform staff
 * approve (10.3).
 *
 * Rules kept here:
 *   - the settlement account's name is always the one Paystack resolved, looked
 *     up again on save — the browser only ever says which account, never whose;
 *   - documents are private Cloudinary assets in this org's own folder, checked
 *     before they're attached, and opened only through a short-lived link;
 *   - a setup under review or approved can't be edited from here;
 *   - nothing ever asks for, or accepts, a Paystack key.
 *
 * Viewing needs `settings.view`; changing it, uploading and opening documents
 * need `settings.edit`.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { listNigerianBanks, resolveAccountName, type PaystackBank } from '@/lib/payments/paystack';
import {
  destroyAsset,
  isOrgDocument,
  privateDownloadUrl,
  signDocumentUpload,
  type SignedUpload,
} from '@/lib/cloudinary/sign';
import {
  DOCUMENT_FORMATS,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_KIND,
  isRegistered,
  normalizeCacNumber,
  normalizeNigerianPhone,
  requiredDocuments,
  setupChecklist,
  type BusinessType,
  type DocumentKind,
  type IdType,
  type SetupStatus,
  type VerificationStatus,
} from '@/lib/payments/payment-setup';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export type PaymentSetupField =
  | 'businessType'
  | 'businessName'
  | 'cacNumber'
  | 'registeredName'
  | 'idType'
  | 'settlementBankCode'
  | 'settlementAccountNumber'
  | 'contactName'
  | 'contactEmail'
  | 'contactPhone'
  | `documents.${DocumentKind}`;

export type PaymentSetupFieldErrors = Partial<Record<PaymentSetupField, string>>;

type FieldFailure = { success: false; error: string; fieldErrors: PaymentSetupFieldErrors };

export interface SetupDocumentRow {
  kind: DocumentKind;
  publicId: string;
  format: string;
  bytes: number;
  fileName: string;
}

export interface PaymentSetupView {
  account: {
    businessType: BusinessType | null;
    businessName: string | null;
    cacNumber: string | null;
    registeredName: string | null;
    idType: IdType | null;
    settlementBankCode: string | null;
    settlementBankName: string | null;
    settlementAccountNumber: string | null;
    settlementAccountName: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    verificationStatus: VerificationStatus;
    setupStatus: SetupStatus;
    rejectionReason: string | null;
    submittedAt: Date | null;
    documents: SetupDocumentRow[];
  } | null;
  /** what the form starts with when nothing is saved yet — the merchant's own records */
  prefill: { businessName: string; contactName: string; contactEmail: string; contactPhone: string };
}

const EDITABLE: VerificationStatus[] = ['UNVERIFIED', 'REJECTED'];

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to change payment settings' };
  }
  console.error(`[payment-setup] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/* ---------------- reading ---------------- */

export async function getPaymentSetup(): Promise<ActionResult<PaymentSetupView>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW);

    const [account, organization, user] = await Promise.all([
      prisma.merchantPaymentAccount.findUnique({
        where: { organizationId: ctx.organization.id },
        include: {
          documents: {
            select: { kind: true, publicId: true, format: true, bytes: true, fileName: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      prisma.organization.findUniqueOrThrow({
        where: { id: ctx.organization.id },
        select: { name: true, supportEmail: true, supportPhone: true },
      }),
      prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } }),
    ]);

    return {
      success: true,
      data: {
        account: account
          ? {
              businessType: account.businessType,
              businessName: account.businessName,
              cacNumber: account.cacNumber,
              registeredName: account.registeredName,
              idType: account.idType,
              settlementBankCode: account.settlementBankCode,
              settlementBankName: account.settlementBankName,
              settlementAccountNumber: account.settlementAccountNumber,
              settlementAccountName: account.settlementAccountName,
              contactName: account.contactName,
              contactEmail: account.contactEmail,
              contactPhone: account.contactPhone,
              verificationStatus: account.verificationStatus,
              setupStatus: account.setupStatus,
              rejectionReason: account.rejectionReason,
              submittedAt: account.submittedAt,
              documents: account.documents,
            }
          : null,
        prefill: {
          businessName: organization.name,
          contactName: user?.name ?? '',
          contactEmail: organization.supportEmail ?? user?.email ?? '',
          contactPhone: organization.supportPhone ?? '',
        },
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your payment setup');
  }
}

/** Paystack's banks — the codes a subaccount takes. */
export async function listSettlementBanks(): Promise<ActionResult<PaystackBank[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const banks = await listNigerianBanks();
    if (banks.length === 0) return { success: false, error: 'We couldn’t load the list of banks. Try again in a moment.' };
    return { success: true, data: banks };
  } catch (error) {
    return failure(error, 'We couldn’t load the list of banks. Try again in a moment.');
  }
}

/* ---------------- the settlement account ---------------- */

/** Lookups per store per window — each one is a call to Paystack. */
const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_MS = 10 * 60 * 1000;

async function resolveSettlement(
  organizationId: string,
  bankCode: string,
  accountNumber: string,
): Promise<{ ok: true; bankName: string; accountName: string } | FieldFailure | { success: false; error: string }> {
  const banks = await listNigerianBanks();
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) {
    return { success: false, error: 'Check the highlighted fields', fieldErrors: { settlementBankCode: 'Choose your bank' } };
  }
  if (!checkRateLimit(`paystack-resolve:${organizationId}`, LOOKUP_LIMIT, LOOKUP_WINDOW_MS)) {
    return { success: false, error: 'Too many account checks. Wait a few minutes and try again.' };
  }
  try {
    const accountName = await resolveAccountName(bankCode, accountNumber);
    if (!accountName) {
      return {
        success: false,
        error: 'Check the highlighted fields',
        fieldErrors: {
          settlementAccountNumber: 'We couldn’t find this account at that bank. Check the number and the bank.',
        },
      };
    }
    return { ok: true, bankName: bank.name, accountName };
  } catch (error) {
    console.error('[payment-setup] account lookup failed:', error);
    return { success: false, error: 'We couldn’t reach the bank to check this account. Try again in a moment.' };
  }
}

const LookupSchema = z.object({
  bankCode: z.string().min(1, 'Choose your bank'),
  accountNumber: z
    .string()
    .transform((v) => v.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{10}$/, 'Account numbers are 10 digits')),
});

export async function lookupSettlementAccount(input: {
  bankCode: string;
  accountNumber: string;
}): Promise<ActionResult<{ accountName: string }> | FieldFailure> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);

    const parsed = LookupSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: PaymentSetupFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === 'bankCode' ? 'settlementBankCode' : 'settlementAccountNumber';
        fieldErrors[key] ??= issue.message;
      }
      return { success: false, error: 'Check the highlighted fields', fieldErrors };
    }

    const resolved = await resolveSettlement(ctx.organization.id, parsed.data.bankCode, parsed.data.accountNumber);
    if (!('ok' in resolved)) return resolved;
    return { success: true, data: { accountName: resolved.accountName } };
  } catch (error) {
    return failure(error, 'We couldn’t check this account');
  }
}

/* ---------------- documents ---------------- */

async function editableAccount(organizationId: string) {
  const account = await prisma.merchantPaymentAccount.findUnique({
    where: { organizationId },
    select: { id: true, verificationStatus: true },
  });
  return { account, editable: !account || EDITABLE.includes(account.verificationStatus) };
}

const LOCKED_MESSAGE = 'Your details are with our team, so they can’t be changed right now.';

/** Signed parameters for one private, direct browser → Cloudinary upload. */
export async function getVerificationUploadSignature(): Promise<ActionResult<SignedUpload>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const { editable } = await editableAccount(ctx.organization.id);
    if (!editable) return { success: false, error: LOCKED_MESSAGE };
    return { success: true, data: signDocumentUpload(ctx.organization.id) };
  } catch (error) {
    return failure(error, 'Uploads aren’t available right now');
  }
}

/**
 * A link that opens one of this store's documents for five minutes. Works for
 * a file uploaded moments ago and not yet saved, since it is checked by folder
 * rather than by row.
 */
export async function getVerificationDocumentUrl(input: {
  publicId: string;
  format: string;
}): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    if (!isOrgDocument(input.publicId, ctx.organization.id) || !isDocumentFormat(input.format)) {
      return { success: false, error: 'That document isn’t available' };
    }
    return { success: true, data: { url: privateDownloadUrl(input.publicId, input.format.toLowerCase()) } };
  } catch (error) {
    return failure(error, 'We couldn’t open this document');
  }
}

function isDocumentFormat(format: string): boolean {
  return (DOCUMENT_FORMATS as readonly string[]).includes(format.toLowerCase());
}

/* ---------------- saving ---------------- */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);

const DocumentSchema = z.object({
  kind: z.enum(['CAC_CERTIFICATE', 'ID_DOCUMENT', 'PROOF_OF_ADDRESS']),
  publicId: z.string().min(1).max(300),
  format: z.string().min(1).max(10),
  bytes: z.number().int().nonnegative(),
  fileName: z.string().trim().min(1).max(200),
});

const SaveSchema = z.object({
  businessType: z.enum(['COMPANY', 'BUSINESS_NAME', 'INDIVIDUAL']).nullable().default(null),
  businessName: optionalText(120),
  cacNumber: optionalText(20),
  registeredName: optionalText(160),
  idType: z.enum(['NIN', 'INTERNATIONAL_PASSPORT', 'DRIVERS_LICENCE', 'VOTERS_CARD']).nullable().default(null),
  settlementBankCode: optionalText(20),
  settlementAccountNumber: optionalText(20),
  contactName: optionalText(120),
  contactEmail: optionalText(200),
  contactPhone: optionalText(30),
  documents: z.array(DocumentSchema).max(MAX_DOCUMENTS_PER_KIND * 3).default([]),
});

export type PaymentSetupInput = z.input<typeof SaveSchema>;

const REQUIRED_MESSAGE: Partial<Record<PaymentSetupField, string>> = {
  businessType: 'Choose what kind of business this is',
  businessName: 'Enter your business name',
  cacNumber: 'Enter your CAC registration number',
  registeredName: 'Enter the name on your CAC certificate',
  idType: 'Choose the ID you’re sending',
  settlementBankCode: 'Choose your bank',
  settlementAccountNumber: 'Enter the account number',
  contactName: 'Enter a contact name',
  contactEmail: 'Enter a contact email',
  contactPhone: 'Enter a contact phone number',
};

/**
 * Save what the merchant has so far (`draft`), or save it and send it for
 * review (`submit`). A draft may be incomplete but nothing in it may be wrong;
 * a submission must be complete. Either way the settlement account's name is
 * fetched from Paystack again here, and documents are checked to belong to
 * this store.
 */
export async function savePaymentSetup(
  input: PaymentSetupInput,
  intent: 'draft' | 'submit',
): Promise<ActionResult<{ submitted: boolean }> | FieldFailure> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const organizationId = ctx.organization.id;

    const parsed = SaveSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Some of these details couldn’t be read. Check them and try again.' };
    const data = parsed.data;

    const { account: existing, editable } = await editableAccount(organizationId);
    if (!editable) return { success: false, error: LOCKED_MESSAGE };

    const fieldErrors: PaymentSetupFieldErrors = {};

    // Format checks — they apply to a draft too: saving something wrong only
    // moves the mistake to later.
    let cacNumber = data.cacNumber;
    const registered = isRegistered(data.businessType);
    if (!registered) cacNumber = null;
    if (registered && cacNumber) {
      const normalized = normalizeCacNumber(cacNumber, data.businessType);
      if (!normalized) {
        fieldErrors.cacNumber =
          data.businessType === 'BUSINESS_NAME'
            ? 'A business name number looks like BN 1234567'
            : 'A company number looks like RC 1234567';
      } else cacNumber = normalized;
    }
    const registeredName = registered ? data.registeredName : null;

    let contactPhone = data.contactPhone;
    if (contactPhone) {
      const normalized = normalizeNigerianPhone(contactPhone);
      if (!normalized) fieldErrors.contactPhone = 'Enter a Nigerian mobile number, like 0803 123 4567';
      else contactPhone = normalized;
    }
    if (data.contactEmail && !z.email().safeParse(data.contactEmail).success) {
      fieldErrors.contactEmail = 'Enter a valid email address';
    }

    const accountNumber = data.settlementAccountNumber?.replace(/\s+/g, '') ?? null;
    if (accountNumber && !/^\d{10}$/.test(accountNumber)) {
      fieldErrors.settlementAccountNumber = 'Account numbers are 10 digits';
    }

    // Documents: this store's private folder only, in a format we accept, and
    // only the kinds this business type needs.
    const neededKinds = new Set(requiredDocuments(data.businessType));
    const documents = data.documents.filter((d) => neededKinds.has(d.kind) || !data.businessType);
    for (const doc of documents) {
      const key = `documents.${doc.kind}` as const;
      if (!isOrgDocument(doc.publicId, organizationId) || !isDocumentFormat(doc.format)) {
        fieldErrors[key] = 'One of these files couldn’t be used. Remove it and upload it again.';
      } else if (doc.bytes > MAX_DOCUMENT_BYTES) {
        fieldErrors[key] = 'Files must be 10 MB or smaller';
      }
    }
    for (const kind of neededKinds) {
      if (documents.filter((d) => d.kind === kind).length > MAX_DOCUMENTS_PER_KIND) {
        fieldErrors[`documents.${kind}`] = `Upload at most ${MAX_DOCUMENTS_PER_KIND} files here`;
      }
    }

    // The settlement account's name comes from Paystack, never the browser.
    let settlement: { bankCode: string; bankName: string; accountNumber: string; accountName: string } | null = null;
    if (data.settlementBankCode && accountNumber && !fieldErrors.settlementAccountNumber) {
      const resolved = await resolveSettlement(organizationId, data.settlementBankCode, accountNumber);
      if (!('ok' in resolved)) {
        if ('fieldErrors' in resolved) Object.assign(fieldErrors, resolved.fieldErrors);
        else return resolved;
      } else {
        settlement = {
          bankCode: data.settlementBankCode,
          bankName: resolved.bankName,
          accountNumber,
          accountName: resolved.accountName,
        };
      }
    }

    const draft = {
      businessType: data.businessType,
      businessName: data.businessName,
      cacNumber,
      registeredName,
      idType: data.idType,
      settlementBankCode: settlement?.bankCode ?? data.settlementBankCode,
      settlementAccountNumber: settlement?.accountNumber ?? accountNumber,
      settlementAccountName: settlement?.accountName ?? null,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone,
      documents,
    };

    if (intent === 'submit') {
      const required: [PaymentSetupField, unknown][] = [
        ['businessType', draft.businessType],
        ['businessName', draft.businessName],
        ['idType', draft.idType],
        ['settlementBankCode', draft.settlementBankCode],
        ['settlementAccountNumber', draft.settlementAccountNumber],
        ['contactName', draft.contactName],
        ['contactEmail', draft.contactEmail],
        ['contactPhone', draft.contactPhone],
      ];
      if (registered) required.push(['cacNumber', draft.cacNumber], ['registeredName', draft.registeredName]);
      for (const [field, value] of required) {
        if (!value && !fieldErrors[field]) fieldErrors[field] = REQUIRED_MESSAGE[field];
      }
      for (const kind of neededKinds) {
        if (!documents.some((d) => d.kind === kind)) {
          fieldErrors[`documents.${kind}`] ??= 'Upload this document';
        }
      }
      if (Object.keys(fieldErrors).length === 0 && !setupChecklist(draft).every((item) => item.done)) {
        return { success: false, error: 'Some details are still missing. Check each section and try again.' };
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        success: false,
        error: intent === 'submit' ? 'Finish the highlighted fields before submitting' : 'Check the highlighted fields',
        fieldErrors,
      };
    }

    const submit = intent === 'submit';
    const now = new Date();
    const columns = {
      businessType: draft.businessType,
      businessName: draft.businessName,
      cacNumber: draft.cacNumber,
      registeredName: draft.registeredName,
      idType: draft.idType,
      // A draft may name the bank before the number; only a resolved pair
      // carries an account name, which is what makes it a settlement account.
      settlementBankCode: draft.settlementBankCode,
      settlementBankName: settlement?.bankName ?? null,
      settlementAccountNumber: draft.settlementAccountNumber,
      settlementAccountName: settlement?.accountName ?? null,
      contactName: draft.contactName,
      contactEmail: draft.contactEmail,
      contactPhone: draft.contactPhone,
      ...(submit
        ? {
            verificationStatus: 'PENDING' as const,
            setupStatus: 'AWAITING_VERIFICATION' as const,
            submittedAt: now,
            submittedById: ctx.userId,
            rejectionReason: null,
          }
        : {}),
    };

    const removed = await prisma.$transaction(async (tx) => {
      let accountId: string;
      if (existing) {
        // Claimed on status, so a submission that raced another one (or a
        // review that started meanwhile) is refused rather than overwritten.
        const updated = await tx.merchantPaymentAccount.updateMany({
          where: { id: existing.id, verificationStatus: { in: EDITABLE } },
          data: columns,
        });
        if (updated.count === 0) throw new LockedError();
        accountId = existing.id;
      } else {
        accountId = (
          await tx.merchantPaymentAccount.create({
            data: { organizationId, ...columns },
            select: { id: true },
          })
        ).id;
      }

      const current = await tx.merchantVerificationDocument.findMany({
        where: { accountId },
        select: { id: true, publicId: true },
      });
      const keep = new Set(documents.map((d) => d.publicId));
      const gone = current.filter((d) => !keep.has(d.publicId));
      if (gone.length) await tx.merchantVerificationDocument.deleteMany({ where: { id: { in: gone.map((d) => d.id) } } });

      const known = new Set(current.map((d) => d.publicId));
      const fresh = documents.filter((d) => !known.has(d.publicId));
      if (fresh.length) {
        await tx.merchantVerificationDocument.createMany({
          data: fresh.map((d) => ({
            organizationId,
            accountId,
            kind: d.kind,
            publicId: d.publicId,
            format: d.format.toLowerCase(),
            bytes: d.bytes,
            fileName: d.fileName,
            uploadedById: ctx.userId,
          })),
        });
      }
      return gone.map((d) => d.publicId);
    });

    // A document the merchant took out is deleted from Cloudinary too — an ID
    // left lying in storage is a liability, not a convenience.
    await Promise.all(removed.map((publicId) => destroyAsset(publicId, { type: 'private' })));

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: submit ? 'settings.payment_setup.submitted' : 'settings.payment_setup.saved',
      entityType: 'MerchantPaymentAccount',
      entityId: organizationId,
      metadata: {
        businessType: draft.businessType,
        accountNumberEnding: settlement?.accountNumber.slice(-4) ?? null,
        documents: documents.length,
      },
    });

    return { success: true, data: { submitted: submit } };
  } catch (error) {
    if (error instanceof LockedError) return { success: false, error: LOCKED_MESSAGE };
    return failure(error, 'We couldn’t save your details');
  }
}

class LockedError extends Error {
  constructor() {
    super('locked');
    this.name = 'LockedError';
  }
}

/**
 * Take a submission back out of review so it can be changed. Only while it's
 * waiting — once staff have decided, there's nothing to withdraw.
 */
export async function withdrawPaymentSetup(): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);

    const updated = await prisma.merchantPaymentAccount.updateMany({
      where: { organizationId: ctx.organization.id, verificationStatus: 'PENDING' },
      data: { verificationStatus: 'UNVERIFIED', setupStatus: 'NOT_STARTED', submittedAt: null, submittedById: null },
    });
    if (updated.count === 0) return { success: false, error: 'There’s nothing waiting for review to take back' };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.payment_setup.withdrawn',
      entityType: 'MerchantPaymentAccount',
      entityId: ctx.organization.id,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t take your details back');
  }
}
