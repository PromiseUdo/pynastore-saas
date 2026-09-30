'use server';

import { confirmEmailToken } from '@/lib/email-verification';

export type ConfirmState = { ok: true } | { ok: false; reason: 'invalid' | 'expired' } | null;

/** Uses the link from the confirmation email (ROADMAP 12.5). */
export async function confirmEmailAction(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const token = String(formData.get('token') ?? '');
  const result = await confirmEmailToken(token);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
