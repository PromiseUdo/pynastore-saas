import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// This machine's LAN IPv4 addresses — lets a phone on the same network load
// the dev server (Capacitor debug builds / live reload) with a working dev runtime.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === "IPv4" && !net.internal)
  .map((net) => net!.address);

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: __dirname,
  },
  // Domain-based multi-tenancy means every request in dev comes from a host
  // other than bare "localhost" (app.localhost, {slug}.app.localhost,
  // shop.{slug}.app.localhost, ...). Next's dev server otherwise BLOCKS its
  // internal /_next/* dev resources (HMR socket, RSC/flight, the dev
  // runtime) from any origin it doesn't recognise — and a blocked dev
  // runtime means the page never hydrates: nothing is interactive, no
  // error shown. See node_modules/next/dist/server/app-render/
  // csrf-protection.js (matchWildcardDomain).
  //
  // The matcher's `*` matches EXACTLY ONE label, so `*.app.localhost` only
  // covers `{slug}.app.localhost` (admin) — NOT the two-label storefront
  // host `shop.{slug}.app.localhost`. `**` is the recursive wildcard and
  // must be the left-most label; `**.app.localhost` covers every depth
  // (admin, storefront, and the `m.app.localhost` mobile origin).
  //
  // LAN IPs are added automatically for on-device testing (see above).
  allowedDevOrigins: ['app.localhost', '*.app.localhost', '**.app.localhost', ...lanAddresses],

  images: {
    remotePatterns: [
      // Merchant uploads (product/category/brand images) — lib/cloudinary.
      { protocol: 'https', hostname: 'res.cloudinary.com', pathname: `/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/**` },
      // The demo catalogue's stock photos (lib/storefront/mock/images.ts) are
      // only ever shown by a local dev server with STOREFRONT_FIXTURES=1 —
      // never proxied by a production build (ROADMAP 13.4).
      ...(process.env.NODE_ENV === 'development'
        ? [
            { protocol: 'https' as const, hostname: 'picsum.photos' },
            { protocol: 'https' as const, hostname: 'fastly.picsum.photos' },
            { protocol: 'https' as const, hostname: 'i.pravatar.cc' },
          ]
        : []),
    ],
  },

  /*
   * Security headers on every response (ROADMAP 13.4). The Content Security
   * Policy isn't here: it needs a fresh nonce per request, so proxy.ts sets
   * it (lib/security/csp.ts).
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // HTTPS only, for two years, on every subdomain (each shop is one).
          // Not "preload": that's a promise to browsers that is slow to take back.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // Never inside someone else's frame (clickjacking); CSP frame-ancestors says the same to newer browsers.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Other sites learn only which site sent a visitor, never the page — paths can hold tokens.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Features no page uses stay off, for us and for any script. The photo search's camera
          // is the browser's own file picker (capture=), which this doesn't affect.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), usb=(), payment=(), browsing-topics=()' },
          // Our pages don't share a window with pages from other sites; sign-in and payment are redirects, not popups.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        ],
      },
    ];
  },
};

export default nextConfig;
