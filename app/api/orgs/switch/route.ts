import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateCurrentOrganization } from '@/lib/session';
import { z } from 'zod';

const SwitchSchema = z.object({
  orgId: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = SwitchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { orgId } = parsed.data;

  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      organizationId: orgId,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    },
    select: {
      organization: { select: { id: true, slug: true } },
    },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Organization not found or access denied' }, { status: 404 });
  }

  await updateCurrentOrganization(
    session.user.id,
    membership.organization.id,
    membership.organization.slug,
  );

  return NextResponse.json({ slug: membership.organization.slug });
}
