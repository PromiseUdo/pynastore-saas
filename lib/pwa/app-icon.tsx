/*
 * lib/pwa/app-icon.tsx
 *
 * The icon a site gets when it's added to a Home Screen (ROADMAP 18.3) —
 * the admin, the platform console, or a store — drawn on request as a PNG.
 *
 * A store with a logo shows it, centred on white inside the safe zone a
 * phone may crop to a circle or squircle ("maskable"). Without one — or if
 * the logo can't be fetched — it's the first letter of the name on the
 * brand colour, which always works. Server only.
 */
import { ImageResponse } from 'next/og';

/** What the manifests ask for: Apple's touch icon, and Android's two. */
export const APP_ICON_SIZES = [180, 192, 512] as const;
export type AppIconSize = (typeof APP_ICON_SIZES)[number];

export function appIconSize(value: string): AppIconSize | null {
  const size = Number(value);
  return (APP_ICON_SIZES as readonly number[]).includes(size) ? (size as AppIconSize) : null;
}

/** The admin's and console's colour: the indigo of --primary in app/globals.css (an image can't read a CSS token). */
export const PLATFORM_ICON_COLOUR = '#4f46e5';

/** A logo uploaded to Cloudinary, as a PNG of at most `size` — the renderer reads PNG, not WebP or AVIF. */
async function logoDataUrl(logoUrl: string | null | undefined, size: number): Promise<string | null> {
  if (!logoUrl || !logoUrl.includes('res.cloudinary.com') || !logoUrl.includes('/image/upload/')) return null;
  const url = logoUrl.replace('/image/upload/', `/image/upload/c_fit,w_${size},h_${size},f_png/`);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function appIconResponse(input: {
  size: AppIconSize;
  name: string;
  background: string;
  foreground: string;
  logoUrl?: string | null;
}): Promise<ImageResponse> {
  const { size } = input;
  // The middle 80% is what every mask keeps.
  const inner = Math.round(size * 0.62);
  const logo = await logoDataUrl(input.logoUrl, inner);
  const letter = (input.name.trim()[0] ?? '?').toUpperCase();
  const headers = { 'Cache-Control': 'public, max-age=86400' };

  return new ImageResponse(
    logo ? (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" width={inner} height={inner} style={{ objectFit: 'contain' }} />
      </div>
    ) : (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: input.background,
          color: input.foreground,
          fontSize: Math.round(size * 0.5),
          fontWeight: 700,
        }}
      >
        {letter}
      </div>
    ),
    { width: size, height: size, headers },
  );
}
