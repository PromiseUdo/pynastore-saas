/*
 * A small fixed "Staging" label on every page of the staging site
 * (docs/STAGING.md), so a test shop, order or email is never mistaken for a
 * real one. Renders nothing anywhere else. Inline styles on purpose: it sits
 * above the admin, the console and every storefront look alike, and belongs
 * to none of their themes. It can't be clicked, so it never covers a button.
 */
import { isStaging } from '@/lib/deploy-stage';

export function StagingBadge() {
  if (!isStaging()) return null;
  return (
    <div
      role="note"
      aria-label="This is the staging site. Test data only."
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 6px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2147483647,
        pointerEvents: 'none',
        padding: '2px 10px',
        borderRadius: 999,
        background: '#b45309',
        color: '#ffffff',
        font: '600 11px/18px system-ui, sans-serif',
        letterSpacing: '0.02em',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      }}
    >
      STAGING · test data only
    </div>
  );
}
