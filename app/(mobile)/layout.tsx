/*
 * app/(mobile)/ — routes served on the dedicated mobile origin only.
 *
 * proxy.ts (siteType 'mobile') rewrites '/' here to '/m'. Storefront pages
 * themselves live in app/store/[organizationSlug] and are reached via
 * /s/{slug} → internal /store/{slug} rewrite — they are NOT under this
 * group.
 */
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="safe-y safe-x flex min-h-[100dvh] flex-col bg-background text-foreground">
      {children}
    </div>
  );
}
