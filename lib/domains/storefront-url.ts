/*
 * The shop's address, on the server: its live custom domain if it has one
 * (ROADMAP 12.6), otherwise the platform address. Read through the same
 * short cache as routing.
 */
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { getOrgRouting } from '@/lib/tenant/org-status';

export async function storefrontUrlFor(orgSlug: string, path = '/'): Promise<string> {
  const { customStoreDomain } = await getOrgRouting(orgSlug);
  return getStorefrontUrl(orgSlug, path, customStoreDomain);
}
