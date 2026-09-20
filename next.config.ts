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

  // Storefront dummy-data imagery. Swap/remove these when the catalog is
  // wired to real product images. See lib/storefront/mock/images.ts.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'fastly.picsum.photos' },
      { protocol: 'https', hostname: 'i.pravatar.cc' },
      // Merchant uploads (product/category/brand images) — lib/cloudinary.
      { protocol: 'https', hostname: 'res.cloudinary.com', pathname: `/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/**` },
    ],
  },
};

export default nextConfig;
