import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    sessionVersion?: number;
  }

  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
    currentOrganizationId?: string;
    currentOrgSlug?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    sessionVersion?: number;
    currentOrganizationId?: string;
    currentOrgSlug?: string;
  }
}

// next-auth/jwt.d.ts re-exports from @auth/core/jwt, which is where the
// `jwt()` callback's `token` parameter type actually originates —
// augmenting only 'next-auth/jwt' doesn't merge onto that source
// interface, so declare it here too.
declare module '@auth/core/jwt' {
  interface JWT {
    userId?: string;
    sessionVersion?: number;
    currentOrganizationId?: string;
    currentOrgSlug?: string;
  }
}
