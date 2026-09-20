/*
 * auth.ts — Full Auth.js v5 configuration (Node.js runtime only).
 *
 * Spreads the Edge-safe authConfig and adds:
 *  - PrismaAdapter  (DB session linking for OAuth accounts)
 *  - Google provider
 *  - Credentials provider (bcrypt password verification via Prisma)
 *  - JWT callbacks that embed currentOrganizationId + currentOrgSlug,
 *    and enforce sessionVersion (see lib/session-version.ts) so a
 *    password reset invalidates every previously issued JWT
 *
 * Never import this file from proxy.ts — use auth.config.ts there.
 */
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authConfig } from '@/auth.config';
import { isSessionVersionValid } from '@/lib/session-version';

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

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

    Credentials({
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            password: true,
            sessionVersion: true,
          },
        });

        // Reject OAuth-only accounts that have no stored password
        if (!user?.password) return null;

        const valid = await compare(password, user.password);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],

  callbacks: {
    // authConfig.callbacks.redirect allows cross-subdomain redirects (see
    // auth.config.ts) — inherit it here since this object replaces
    // authConfig.callbacks wholesale rather than merging into it.
    redirect: authConfig.callbacks.redirect,

    async jwt({ token, user, trigger, session }) {
      // On initial sign-in, user is provided
      if (user?.id) {
        token.userId = user.id;
        token.sessionVersion = user.sessionVersion ?? 0;

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
      return session;
    },
  },
});
