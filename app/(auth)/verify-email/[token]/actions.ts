'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { confirmEmailToken } from '@/lib/email-verification';

export type ConfirmState = { ok: true } | { ok: false; reason: 'invalid' | 'expired' } | null;

/**
 * Uses the link from the confirmation email (ROADMAP 12.5).
 *
 * A link that's already been used is usually one a mail scanner opened
 * first — which still means the inbox's owner confirmed it. So when the
 * person opening it is signed in and already confirmed, that's success, not
 * "this link doesn't work".
 */
export async function confirmEmailAction(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const token = String(formData.get('token') ?? '');
  const result = await confirmEmailToken(token);
  if (result.ok) return { ok: true };
  if (result.reason === 'invalid' && (await signedInAndConfirmed())) return { ok: true };
  return { ok: false, reason: result.reason };
}

async function signedInAndConfirmed(): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.id) return false;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { emailVerified: true } });
  return Boolean(user?.emailVerified);
}
