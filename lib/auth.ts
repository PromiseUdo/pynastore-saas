/*
 * Re-export Auth.js primitives so the rest of the app always imports
 * from '@/lib/auth' — keeping the root auth.ts as the single config file.
 *
 * Server components, server actions, and middleware all use this module.
 * Client components use `next-auth/react` directly (signOut, useSession).
 */
export { auth, signIn, signOut, unstable_update } from '@/auth';
