'use server';

/*
 * features/settings/bank-accounts.ts
 *
 * The merchant's bank accounts, offered at checkout as "Bank transfer".
 *
 * Checkout shows the transfer option only while at least one account is
 * active (lib/storefront/checkout/store-config.ts). Orders keep a copy of the
 * details they were placed with, so editing or removing an account here never
 * changes the instructions a shopper is already following.
 *
 * The merchant picks a bank and types the number; the account name always
 * comes from the bank via Squad's lookup — checked again on save, so the
 * name customers see can't be typed in by hand.
 *
 * Viewing needs `settings.view`; changing needs `settings.edit`.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { lookupAccountName } from '@/lib/payments/squad';
import { bankByCode } from '@/lib/payments/nigerian-banks';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface BankAccountRow {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  isActive: boolean;
}

export type BankAccountFieldErrors = Partial<Record<'bankCode' | 'accountNumber', string>>;

const AccountSchema = z.object({
  bankCode: z.string().refine((code) => bankByCode(code) !== undefined, 'Choose your bank'),
  accountNumber: z
    .string()
    .transform((v) => v.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{10}$/, 'Account numbers are 10 digits')),
  isActive: z.boolean().default(true),
});

export type BankAccountInput = z.input<typeof AccountSchema>;

type FieldFailure = { success: false; error: string; fieldErrors: BankAccountFieldErrors };

function fieldFailure(error: z.ZodError): FieldFailure {
  const fieldErrors: BankAccountFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof BankAccountFieldErrors;
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { success: false, error: 'Check the highlighted fields', fieldErrors };
}

/** Lookups per store per window — each one is a paid call to Squad. */
const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Ask the bank whose account this is. The name comes back from Squad, never
 * from the merchant, so customers see exactly what their banking app will
 * show when they transfer.
 */
async function resolveAccountName(
  organizationId: string,
  bankCode: string,
  accountNumber: string,
): Promise<{ ok: true; accountName: string } | FieldFailure | { success: false; error: string }> {
  if (!checkRateLimit(`bank-lookup:${organizationId}`, LOOKUP_LIMIT, LOOKUP_WINDOW_MS)) {
    return { success: false, error: 'Too many account checks. Wait a few minutes and try again.' };
  }
  try {
    const accountName = await lookupAccountName(bankCode, accountNumber);
    if (!accountName) {
      return {
        success: false,
        error: 'Check the highlighted fields',
        fieldErrors: { accountNumber: 'We couldn’t find this account at that bank. Check the number and the bank.' },
      };
    }
    return { ok: true, accountName };
  } catch (error) {
    console.error('[settings] bank account lookup failed:', error);
    return { success: false, error: 'We couldn’t reach the bank to check this account. Try again in a moment.' };
  }
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to change payment settings' };
  }
  console.error(`[settings] ${fallback}:`, error);
  return { success: false, error: fallback };
}

export async function listBankAccounts(): Promise<ActionResult<BankAccountRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW);

    const accounts = await prisma.merchantBankAccount.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, bankName: true, accountName: true, accountNumber: true, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return { success: true, data: accounts };
  } catch (error) {
    return failure(error, 'We couldn’t load your bank accounts');
  }
}

export async function lookupBankAccountName(
  input: Omit<BankAccountInput, 'isActive'>,
): Promise<ActionResult<{ accountName: string }> | FieldFailure> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);

    const parsed = AccountSchema.safeParse(input);
    if (!parsed.success) return fieldFailure(parsed.error);

    const resolved = await resolveAccountName(ctx.organization.id, parsed.data.bankCode, parsed.data.accountNumber);
    if (!('ok' in resolved)) return resolved;
    return { success: true, data: { accountName: resolved.accountName } };
  } catch (error) {
    return failure(error, 'We couldn’t check this account');
  }
}

export async function saveBankAccount(
  id: string | null,
  input: BankAccountInput,
): Promise<ActionResult<{ id: string }> | FieldFailure> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);

    const parsed = AccountSchema.safeParse(input);
    if (!parsed.success) return fieldFailure(parsed.error);

    const { bankCode, accountNumber, isActive } = parsed.data;
    if (id) {
      const exists = await prisma.merchantBankAccount.count({ where: { id, organizationId: ctx.organization.id } });
      if (exists === 0) return { success: false, error: 'That bank account no longer exists' };
    }

    // Looked up again here rather than trusted from the dialog: the browser
    // only ever tells us which account, never whose it is.
    const resolved = await resolveAccountName(ctx.organization.id, bankCode, accountNumber);
    if (!('ok' in resolved)) return resolved;

    const data = { bankName: bankByCode(bankCode)!.name, accountName: resolved.accountName, accountNumber, isActive };
    let savedId: string;

    if (id) {
      const updated = await prisma.merchantBankAccount.updateMany({
        where: { id, organizationId: ctx.organization.id },
        data,
      });
      if (updated.count === 0) return { success: false, error: 'That bank account no longer exists' };
      savedId = id;
    } else {
      savedId = (
        await prisma.merchantBankAccount.create({
          data: { ...data, organizationId: ctx.organization.id },
          select: { id: true },
        })
      ).id;
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: id ? 'settings.bank_account.update' : 'settings.bank_account.create',
      entityType: 'MerchantBankAccount',
      entityId: savedId,
      metadata: { bankName: data.bankName, accountNumberEnding: data.accountNumber.slice(-4), isActive: data.isActive },
    });

    return { success: true, data: { id: savedId } };
  } catch (error) {
    return failure(error, 'We couldn’t save this bank account');
  }
}

export async function setBankAccountActive(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);

    const updated = await prisma.merchantBankAccount.updateMany({
      where: { id, organizationId: ctx.organization.id },
      data: { isActive },
    });
    if (updated.count === 0) return { success: false, error: 'That bank account no longer exists' };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: isActive ? 'settings.bank_account.activate' : 'settings.bank_account.deactivate',
      entityType: 'MerchantBankAccount',
      entityId: id,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t update this bank account');
  }
}

export async function deleteBankAccount(id: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);

    const deleted = await prisma.merchantBankAccount.deleteMany({
      where: { id, organizationId: ctx.organization.id },
    });
    if (deleted.count === 0) return { success: false, error: 'That bank account no longer exists' };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.bank_account.delete',
      entityType: 'MerchantBankAccount',
      entityId: id,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t remove this bank account');
  }
}
