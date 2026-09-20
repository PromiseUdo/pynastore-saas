/*
 * auth.config.ts — shared auth configuration (Providers/Prisma-free).
 *
 * This file intentionally imports no Node-only libraries (no Prisma, no
 * bcryptjs) so it stays cheap to instantiate wherever proxy.ts uses it for
 * a JWT-only check. auth.ts spreads this config and adds the Prisma
 * adapter + full providers on top.
 *
 * Domain-based multi-tenancy note: login happens on the marketing root
 * domain, but the session cookie must be readable on every tenant
 * subdomain ({slug}.{ROOT_DOMAIN}) afterward, and a post-login redirect
 * may need to land on a subdomain too. Both are handled here so both
 * proxy.ts's JWT-only auth() and auth.ts's full sign-in flow share the
 * same behavior.
 */
import type { NextAuthConfig } from 'next-auth';

function getRootDomain(): string {
  return process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
}

/** Hostname portion only (no port) — Set-Cookie's Domain attribute can't carry a port. */
function getRootHostname(): string {
  return getRootDomain().split(':')[0];
}

/** Allow redirects to the marketing domain or any of its subdomains (tenant admin/storefront). */
export async function isTrustedRedirectTarget(url: string, baseUrl: string): Promise<boolean> {
  try {
    const target = new URL(url, baseUrl);
    const rootHostname = getRootHostname();
    return target.hostname === rootHostname || target.hostname.endsWith(`.${rootHostname}`);
  } catch {
    return false;
  }
}

export const authConfig = {
  session: { strategy: 'jwt' },

  // Cross-subdomain session: a leading dot scopes the cookie to the root
  // domain and every subdomain of it (works for *.localhost in Chrome/Firefox too).
  cookies: {
    sessionToken: {
      options: {
        domain: `.${getRootHostname()}`,
      },
    },
  },

  pages: {
    signIn: '/login',
    error: '/login',
    newUser: '/onboarding',
  },

  /*
   * Providers are intentionally empty here.
   * auth.ts registers Google + Credentials (both need Node.js / DB).
   * The proxy only needs to verify the JWT — it never calls authorize().
   */
  providers: [],

  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      }
      // currentOrganizationId, currentOrgSlug are written by auth.ts on sign-in
      // and by unstable_update on org switch. Just pass them through here.
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
      }
      if (token.currentOrganizationId) {
        session.currentOrganizationId = token.currentOrganizationId as string;
      }
      if (token.currentOrgSlug) {
        session.currentOrgSlug = token.currentOrgSlug as string;
      }
      return session;
    },

    // signIn()'s redirectTo may point at a tenant subdomain (e.g. after
    // following a callbackUrl from proxy.ts). Auth.js's default redirect
    // callback restricts redirects to same-origin only, which would reject
    // that — allow anything under ROOT_DOMAIN instead.
    async redirect({ url, baseUrl }) {
      if (await isTrustedRedirectTarget(url, baseUrl)) {
        return new URL(url, baseUrl).toString();
      }
      return baseUrl;
    },
  },
} satisfies NextAuthConfig;
