/*
 * lib/tenant/getCurrentOrganization.ts
 *
 * Re-exports the existing org/membership resolver from lib/organization.ts
 * under the lib/tenant/ namespace so tenant resolution has one discoverable
 * home. The underlying implementation is unchanged and untouched — it has
 * ~40 call sites and already works entirely off the x-org-slug request
 * header, regardless of whether that header was populated from the URL
 * path (old) or the request hostname (new, see proxy.ts).
 */
export { getOrganizationContext as getCurrentOrganization, getOrganizationId } from '@/lib/organization';
export type { OrganizationContext, MembershipRole } from '@/lib/organization';
