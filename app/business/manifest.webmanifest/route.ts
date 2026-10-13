/*
 * /manifest.webmanifest on the business host (ROADMAP 19.1) — proxy.ts
 * rewrites it here. The admin's own: it names no shop, so it is the same
 * for every shop the session may be in, and loads without a session.
 */
export { GET } from '@/app/(dashboard)/[organizationSlug]/manifest.webmanifest/route';
