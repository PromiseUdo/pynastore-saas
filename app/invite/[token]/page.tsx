import { prisma } from '@/lib/prisma';
import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { acceptInvitation } from '@/features/invitations/actions';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { AcceptForm } from './accept-form';
import { getAdminUrl } from '@/lib/tenant/urls';
import { PLATFORM_NAME } from '@/lib/brand';

type Params = { token: string };
type SearchParams = { auto?: string; err?: string };

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ token }, { auto, err }] = await Promise.all([params, searchParams]);

  // ── 1. Look up invitation ──────────────────────────────────────────────────
  const invitation = await prisma.invitation.findUnique({
    where: { token },
    select: {
      id: true,
      email: true,
      status: true,
      expiresAt: true,
      roleId: true,
      invitedById: true,
      organization: {
        select: { id: true, name: true, slug: true, status: true },
      },
    },
  });

  if (!invitation) {
    return (
      <InviteErrorPage
        title="Invitation not found"
        description="This invitation link is invalid or has been removed."
      />
    );
  }

  if (invitation.organization.status !== 'ACTIVE') {
    return (
      <InviteErrorPage
        title="Organization unavailable"
        description="This organization is no longer active."
      />
    );
  }

  // ── 2. Status check (catches previously-marked EXPIRED/REVOKED/ACCEPTED) ──
  if (invitation.status !== 'PENDING') {
    if (invitation.status === 'ACCEPTED') {
      // Membership already exists — skip the error screen and go straight to the org.
      const session = await auth();
      const dashboardUrl = getAdminUrl(invitation.organization.slug, '/dashboard');
      if (session?.user?.id) {
        redirect(dashboardUrl);
      } else {
        redirect(`/login?callbackUrl=${encodeURIComponent(dashboardUrl)}`);
      }
    }

    const descriptions: Record<string, string> = {
      REVOKED: 'This invitation was revoked. Contact the organization to request a new one.',
      EXPIRED: `This invitation has expired. Contact ${invitation.organization.name} to request a new one.`,
    };
    return (
      <InviteErrorPage
        title="Invitation unavailable"
        description={descriptions[invitation.status] ?? 'This invitation is no longer valid.'}
      />
    );
  }

  // ── 3. Lazy expiry: detect and persist in DB on first hit ─────────────────
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'EXPIRED' },
    });
    return (
      <InviteErrorPage
        title="Invitation expired"
        description={`This invitation has expired. Contact ${invitation.organization.name} to request a new one.`}
      />
    );
  }

  // ── 4. Fetch display data in parallel ─────────────────────────────────────
  const [role, inviter] = await Promise.all([
    prisma.role.findUnique({ where: { id: invitation.roleId }, select: { name: true } }),
    invitation.invitedById
      ? prisma.user.findUnique({
          where: { id: invitation.invitedById },
          select: { name: true, email: true },
        })
      : Promise.resolve(null),
  ]);

  const inviterName = inviter?.name ?? inviter?.email ?? 'A teammate';
  const roleName = role?.name ?? 'Team Member';
  const { name: orgName } = invitation.organization;
  const orgInitial = orgName.charAt(0).toUpperCase();

  // ── 5. Auth decision gate ─────────────────────────────────────────────────
  const session = await auth();

  // Path B: not signed in — smart routing based on whether the email exists
  if (!session?.user?.id) {
    const existingUser = await prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });

    if (existingUser) {
      // User has an account — send them to login and bring them back here
      redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
    } else {
      // New user — send them to register; the invite token travels with them
      redirect(`/register?invite=${encodeURIComponent(token)}`);
    }
  }

  // Path A: signed in ────────────────────────────────────────────────────────

  // Critical security check: the signed-in email must match the invite email
  if (session.user.email !== invitation.email) {
    async function handleSignOut() {
      'use server';
      await signOut({ redirectTo: `/invite/${token}` });
    }

    return (
      <PageShell>
        <Wordmark />
        <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
          <OrgBadge orgInitial={orgInitial} orgName={orgName} inviterName={inviterName} />
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="mb-1.5 text-xl font-semibold tracking-tight">Wrong account</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            This invitation was sent to <strong>{invitation.email}</strong>. You&apos;re currently
            signed in as <strong>{session.user.email}</strong>. Sign out and sign in with the
            correct account to accept.
          </p>
          <form action={handleSignOut}>
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out and switch accounts
            </Button>
          </form>
        </div>
      </PageShell>
    );
  }

  // Server action bound to this token. Must go through a form POST so that
  // updateCurrentOrganization / unstable_update can write the session cookie.
  async function handleAccept() {
    'use server';
    const result = await acceptInvitation(token);
    if (result && !result.success) {
      redirect(`/invite/${token}?err=${encodeURIComponent(result.error)}`);
    }
  }

  return (
    <PageShell>
      <Wordmark />
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <OrgBadge orgInitial={orgInitial} orgName={orgName} inviterName={inviterName} />
        <h1 className="mb-1.5 text-xl font-semibold tracking-tight">You&apos;re invited!</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          <strong>{inviterName}</strong> has invited you to join{' '}
          <strong>{orgName}</strong> as a <strong>{roleName}</strong>.
        </p>
        <AcceptForm
          action={handleAccept}
          errorMessage={err ? decodeURIComponent(err) : undefined}
          autoSubmit={auto === '1'}
        />
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        This invitation expires on{' '}
        {new Date(invitation.expiresAt).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </p>
    </PageShell>
  );
}

// ── Shared layout components ───────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-12">
      {children}
    </div>
  );
}

function Wordmark() {
  return (
    <div className="mb-8 flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
        S
      </div>
      <span className="text-base font-semibold text-foreground">{PLATFORM_NAME}</span>
    </div>
  );
}

function OrgBadge({
  orgInitial,
  orgName,
  inviterName,
}: {
  orgInitial: string;
  orgName: string;
  inviterName: string;
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-base font-bold text-primary">
        {orgInitial}
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{orgName}</p>
        <p className="text-xs text-muted-foreground">Invited by {inviterName}</p>
      </div>
    </div>
  );
}

function InviteErrorPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          S
        </div>
        <span className="text-base font-semibold text-foreground">{PLATFORM_NAME}</span>
      </div>
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
        </div>
        <h1 className="mb-2 text-lg font-semibold">{title}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{description}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    </div>
  );
}
