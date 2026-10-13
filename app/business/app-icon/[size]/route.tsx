/*
 * /app-icon/{size} on the business host (ROADMAP 19.1) — proxy.ts rewrites
 * it here. The admin's own icon, which names no shop.
 */
export { GET } from '@/app/(dashboard)/[organizationSlug]/app-icon/[size]/route';
