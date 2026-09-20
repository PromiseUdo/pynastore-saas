---
name: project-auth-architecture
description: Auth.js v5 + JWT + multi-tenant URL/org-context pattern, key conventions for server actions and the membership system
metadata:
  type: project
---

Auth.js v5 (beta.31) with JWT session strategy. `proxy.ts` replaces `middleware.ts` (Next.js 16).

**JWT fields:** `userId`, `currentOrganizationId`, `currentOrgSlug` — written in `auth.ts` jwt callback on sign-in and via `unstable_update` on org switch.

**Org context resolution flow:**
1. `proxy.ts` reads first URL segment → sets `x-org-slug` request header
2. `getOrganizationContext()` in `lib/organization.ts` reads that header, queries Prisma for membership + role + permissions
3. Cached per-request via React `cache()`

**Key conventions for server actions:**
1. `const ctx = await getOrganizationContext()` (org-scoped)
2. `requirePermission(ctx.membership.role.permissions, PERMISSIONS.X)` 
3. Verify all entity IDs belong to `ctx.organization.id` before mutating
4. Return `{ success: true, data } | { success: false, error: string }` — never throw to client
5. Call `createAuditLog()` after successful mutations (non-blocking)

**Session update pattern:** Call `updateCurrentOrganization(userId, orgId, orgSlug)` from `lib/session.ts` — wraps `unstable_update` from auth.ts. Must be called from server action or route handler context (needs cookie write access).

**Org switcher:** Memberships fetched once in `app/(dashboard)/layout.tsx` server component, passed as props through DashboardLayout → Sidebar → OrgSwitcher. No client-side DB fetch.

**Invite flow:** Token-based. `acceptInvitation(token)` derives everything from token — never trusts client-passed IDs. Unauthenticated users redirected to `/register?invite=TOKEN` or `/login?callbackUrl=/invite/TOKEN`. Register/login pages pass token through hidden form fields so redirect after auth lands back on invite page.

**File locations:**
- Auth config: `auth.ts` (Node.js), `auth.config.ts` (Edge-safe)
- Session utils: `lib/session.ts` (updateCurrentOrganization)
- Email: `lib/email.ts` + `emails/invitation.tsx`
- Org actions: `features/org/actions.ts` (createOrganization, switchOrganization)
- Invitation actions: `features/invitations/actions.ts`
- Member actions: `features/members/actions.ts`
- Members page: `app/(dashboard)/[organizationSlug]/settings/members/page.tsx`
- Invite page: `app/invite/[token]/page.tsx` (public, no auth needed to view)

**Why:** Multi-tenant ERP SaaS where every user can belong to multiple orgs. Org context must be available in every server action without repeated URL parsing.
