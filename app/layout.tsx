import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { NativeShell } from '@/components/native/native-shell';
import { PLATFORM_NAME } from '@/lib/brand';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: PLATFORM_NAME,
    template: `%s · ${PLATFORM_NAME}`,
  },
  description: 'Modern multi-tenant ERP platform',
};

// viewport-fit=cover + no user zoom is required for a native-feeling
// Capacitor shell (safe-area insets, no pinch-zoom on the storefront).
// Harmless on the web. See node_modules/next/dist/docs/.../generate-viewport.md.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0c' },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // proxy.ts stamps `x-runtime: mobile` for requests on the mobile origin —
  // surface it as a data attribute so CSS / client guards can react before
  // the Capacitor bridge reports in.
  const runtime = (await headers()).get('x-runtime') === 'mobile' ? 'mobile' : undefined;

  return (
    <html
      lang="en"
      data-runtime={runtime}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full bg-background text-foreground">
        <NativeShell />
        {children}
      </body>
    </html>
  );
}
