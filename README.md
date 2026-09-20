This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://app.localhost:3000](http://app.localhost:3000) with your browser to see the result (see "Multi-tenancy" below for why it's `app.localhost` and not bare `localhost`).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Multi-tenancy (domain-based)

Organizations are identified by request **hostname**, not URL path — see `proxy.ts` and `lib/tenant/`. The public URL never contains an org slug.

- `{ROOT_DOMAIN}` and `www.{ROOT_DOMAIN}` — marketing.
- `{PLATFORM_HOST}` — the platform site: login, register, onboarding, invites, OAuth callbacks.
- `{slug}.{ROOT_DOMAIN}` — a tenant's admin dashboard (rewritten internally to `/${slug}/...`).
- `shop-{slug}.{ROOT_DOMAIN}` — that tenant's storefront (rewritten to `/store/${slug}/...`).
- `m.{ROOT_DOMAIN}` — the mobile app's single origin; the slug travels in the path as `/s/{slug}`. See MOBILE.md.
- anything else — a merchant's custom domain, resolved by a DB lookup.

Every platform hostname is a **single label** under `{ROOT_DOMAIN}`, which is why the storefront prefix is `shop-` and not `shop.`: one wildcard certificate (`*.{ROOT_DOMAIN}`) then covers the whole platform, and adding a tenant needs no DNS or certificate work. The two-label `shop.{slug}.` shape is still *parsed* so old links keep working, but nothing generates it.

Because a slug is a hostname, some names can't be handed out — see `lib/tenant/reserved-slugs.ts`.

`NEXT_PUBLIC_ROOT_DOMAIN` in `.env` controls the root domain for both local dev and prod. Locally it's set to `app.localhost:3000` rather than bare `localhost:3000` — see the comment above it in `.env` for why (a `next dev`-specific redirect quirk outside of Vercel).

`NEXT_PUBLIC_PLATFORM_HOST` splits the platform host from the root domain, and is only needed in production (`app.getnotely.io`): without it, `app.{ROOT_DOMAIN}` would parse as a tenant called "app". **Leave it unset locally** — it then falls back to `NEXT_PUBLIC_ROOT_DOMAIN`, which locally already *is* the platform host.

**Testing tenant subdomains locally**: Chrome and Firefox resolve any `*.localhost` hostname to `127.0.0.1` automatically — no `/etc/hosts` edit needed. With `npm run dev` running:

- `http://app.localhost:3000` — marketing/login
- `http://test-company.app.localhost:3000` — that org's admin dashboard
- `http://shop-test-company.app.localhost:3000` — that org's storefront
- `http://shop.test-company.app.localhost:3000` — the same storefront, legacy shape, still accepted

Safari's support for `*.localhost` subdomains is inconsistent — use Chrome or Firefox for this.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
