/*
 * The Pynastore logo at the top of the platform's own emails — the brand
 * pack's primary horizontal logo as a PNG (public/brand), because email apps
 * don't reliably show SVG. 24px tall: the pack's minimum for the full logo.
 * The image is served from the marketing host, so it must be an absolute URL.
 * Shops' emails (orders, invoices) head with the shop's name or logo instead.
 */
import { Img } from '@react-email/components';
import type * as React from 'react';
import { PLATFORM_NAME } from '@/lib/brand';
import { getMarketingUrl } from '@/lib/tenant/urls';

export function PlatformEmailLogo({ align = 'left', style }: { align?: 'left' | 'center'; style?: React.CSSProperties }) {
  return (
    <Img
      src={getMarketingUrl('/brand/pynastore-logo-email.png')}
      width="162"
      height="24"
      alt={PLATFORM_NAME}
      style={{ display: 'block', margin: align === 'center' ? '0 auto' : '0', ...style }}
    />
  );
}
