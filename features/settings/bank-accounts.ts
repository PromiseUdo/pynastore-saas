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
 * Viewing needs `settings.view`; changing needs `settings.edit`.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface BankAccountRow {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  isActive: boolean;
}

export type BankAccountFieldErrors = Partial<Record<'bankName' | 'accountName' | 'accountNumber', string>>;

const AccountSchema = z.object({
  bankName: z.string().trim().min(2, 'Enter the bank’s name').max(80, 'Keep the bank name under 80 characters'),
  accountName: z
    .string()
    .trim()
    .min(2, 'Enter the name on the account')
    .max(120, 'Keep the account name under 120 characters'),
  accountNumber: z
    .string()
    .transform((v) => v.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{10}$/, 'Account numbers are 10 digits')),
  isActive: z.boolean().default(true),
});

export type BankAccountInput = z.input<typeof AccountSchema>;

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

export async function saveBankAccount(
  id: string | null,
  input: BankAccountInput,
): Promise<ActionResult<{ id: string }> | { success: false; error: string; fieldErrors: BankAccountFieldErrors }> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);

    const parsed = AccountSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: BankAccountFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof BankAccountFieldErrors;
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { success: false, error: 'Check the highlighted fields', fieldErrors };
    }

    const data = parsed.data;
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
