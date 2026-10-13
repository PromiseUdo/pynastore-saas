/*
 * lib/notifications/owner-notices.ts
 *
 * The emails a shop's owners already get about the shop's own account — the
 * trial ending, the domain, the store app (ROADMAP 12.5, 12.6, 16.2) — also
 * land in their notification list, with a push, in the same words
 * ('account.notice', ROADMAP 18.6). The email itself is still sent where it
 * always was; this adds the rest. Never throws.
 */
import { notify } from './notify';

export async function listOwnerNotice(
  organizationId: string,
  email: { heading: string; paragraphs: string[] },
  path: string,
  key?: string,
): Promise<void> {
  await notify({
    kind: 'account.notice',
    organizationId,
    key,
    facts: { title: email.heading, body: email.paragraphs[0] ?? '', path },
  });
}
