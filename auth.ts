/*
 * auth.ts — Full Auth.js v5 configuration (Node.js runtime only).
 *
 * Spreads the Edge-safe authConfig and adds:
 *  - PrismaAdapter  (DB session linking for OAuth accounts)
 *  - Google provider
 *  - Credentials provider (bcrypt password verification via Prisma)
 *  - Apple provider, when configured (ROADMAP 19.2, lib/apple-sign-in.ts)
 *  - "app-handoff": spends a business-app sign-in ticket (ROADMAP 19.2,
 *    lib/business-app/tickets.ts) — how a Google or Apple sign-in finished
 *    in the app's browser sheet reaches the app's own WebView
 *  - "two-factor": spends a verified two-step sign-in ticket (ROADMAP 14.5,
 *    lib/account-security/two-factor.ts). The password provider refuses an
 *    account with two-step sign-in on, so a password alone never signs it in
 *  - JWT callbacks that embed currentOrganizationId + currentOrgSlug,
 *    record how the session signed in (`signInMethod`), and enforce
 *    sessionVersion (see lib/session-version.ts) so a password reset or
 *    "sign out other devices" invalidates every previously issued JWT
 *
 * Never import this file from proxy.ts — use auth.config.ts there.
 */
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Apple from 'next-auth/providers/apple';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import { authConfig } from '@/auth.config';
import { isSessionVersionValid } from '@/lib/session-version';
import { markEmailVerified } from '@/lib/email-verification';
import { appleClientId, appleClientSecret } from '@/lib/apple-sign-in';
import { userForAppTicket } from '@/lib/business-app/handoff-user';
import { spendSignInChallenge } from '@/lib/account-security/two-factor';
import { userForPassword } from '@/lib/account-security/password-sign-in';
import { spendRenewTicket } from '@/lib/account-security/renew';

/** Only when every Apple setting is present; otherwise there is no button either. */
const appleSecret = appleClientSecret();

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,

  adapter: PrismaAdapter(prisma),

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      /*
       * Allows a user who registered with email/password to later sign in
       * with Google using the same address — safe because Google verifies
       * email ownership.
       */
      allowDangerousEmailAccountLinking: true,
    }),

    ...(appleSecret
      ? [
          Apple({
            clientId: appleClientId()!,
            clientSecret: appleSecret,
            // Apple confirms the address too (a private relay address included).
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),

    /* The business app's sign-in ticket: minted in the sheet by
     * /api/business/auth/finish once Google or Apple said yes, spent here —
     * in the app's WebView — with the verifier only that WebView holds. */
    Credentials({
      id: 'app-handoff',
      credentials: { token: {}, verifier: {} },
      authorize: (raw) => userForAppTicket(raw?.token, raw?.verifier),
    }),

    /* Two-step sign-in's second step: the password was checked by the login
     * action, the code by answerSignInChallenge; this spends the ticket once. */
    Credentials({
      id: 'two-factor',
      credentials: { ticket: {} },
      async authorize(raw) {
        const userId = await spendSignInChallenge(raw?.ticket);
        if (!userId) return null;
        const user = await prisma.user.findFirst({
          where: { id: userId, deletedAt: null },
          select: { id: true, email: true, name: true, image: true, sessionVersion: true },
        });
        return user ?? null;
      },
    }),

    // A password alone — refused for an account with two-step sign-in on.
    Credentials({
      authorize: (raw) => userForPassword(raw),
    }),
  ],

  events: {
    /* Google (and Apple) have already confirmed the address, so such a sign-in counts
     * as a verified email (ROADMAP 12.5) — including for someone who signed
     * up with a password first. */
    async signIn({ user, account }) {
      if ((account?.provider === 'google' || account?.provider === 'apple') && user.id) await markEmailVerified(user.id);
    },
  },

  callbacks: {
    // authConfig.callbacks.redirect allows cross-subdomain redirects (see
    // auth.config.ts) — inherit it here since this object replaces
    // authConfig.callbacks wholesale rather than merging into it.
    redirect: authConfig.callbacks.redirect,

    async jwt({ token, user, account, trigger, session }) {
      // On initial sign-in, user is provided
      if (user?.id) {
        token.userId = user.id;
        token.sessionVersion = user.sessionVersion ?? 0;
        // 'credentials' (a password alone), 'two-factor', 'google', 'apple' or 'app-handoff' (ROADMAP 14.5).
        token.signInMethod = account?.provider ?? 'credentials';

        // Embed the user's first active org into the JWT
        const membership = await prisma.membership.findFirst({
          where: {
            userId: user.id,
            status: 'ACTIVE',
            organization: { status: 'ACTIVE' },
          },
          select: {
            organizationId: true,
            organization: { select: { slug: true } },
          },
          orderBy: { joinedAt: 'asc' },
        });

        if (membership) {
          token.currentOrganizationId = membership.organizationId;
          token.currentOrgSlug = membership.organization.slug;
        }
      } else if (token.userId) {
        // "Sign out other devices" keeps this one: a RENEW ticket only a
        // server action can make (lib/account-security/sessions.ts).
        if (trigger === 'update' && session && typeof session === 'object' && 'renewTicket' in session) {
          const renewed = await spendRenewTicket(token.userId as string, (session as { renewTicket?: unknown }).renewTicket);
          if (renewed) {
            token.sessionVersion = renewed.version;
            if (renewed.provedSecondFactor) token.signInMethod = 'two-factor';
          }
        }
        // Re-validated on every request (session.strategy: 'jwt' means
        // Auth.js calls this callback on every auth() check, not just at
        // sign-in). If the user's sessionVersion has moved on — e.g. a
        // password reset — this JWT was issued before that and must be
        // rejected outright so the session becomes invalid immediately,
        // rather than lingering until its natural expiry.
        const valid = await isSessionVersionValid(
          token.userId as string,
          token.sessionVersion,
        );
        if (!valid) return null;
      }

      // Handle session updates from unstable_update (org switching)
      if (trigger === 'update' && session) {
        if (session.currentOrganizationId) {
          token.currentOrganizationId = session.currentOrganizationId;
        }
        if (session.currentOrgSlug) {
          token.currentOrgSlug = session.currentOrgSlug;
        }
      }

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
      session.signInMethod = token.signInMethod ?? null;
      return session;
    },
  },
});
