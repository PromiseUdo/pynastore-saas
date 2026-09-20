/*
 * Social Commerce → choose which accounts to connect.
 *
 * Where a merchant lands after authorising MansaaS with Meta. The accounts
 * were fetched server-side in the callback route and parked in an encrypted,
 * store-and-member-bound draft; `?draft=` carries only that draft's id, which
 * is meaningless to anyone else.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { Button } from '@/components/ui/button';
import { getConnectionDraft } from '@/features/social/actions';
import { ChooseAccountsClient } from './_components/ChooseAccountsClient';

export const metadata: Metadata = { title: 'Choose accounts' };

export default async function ConnectSocialPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SOCIAL_MANAGE)) {
    return <AccessDenied what="connecting social accounts" />;
  }

  const { draft: draftId } = await searchParams;

  const expired = (
    <div>
      <PageHeader title="Choose accounts" description="Pick the accounts this store should post from." />
      <PageBody>
        <EmptyState
          title="That connection attempt has expired"
          description="For safety, a connection has to be finished within a few minutes of signing in to Facebook. Start again and it will only take a moment."
          action={
            <Button asChild>
              <Link href="/social">Back to social accounts</Link>
            </Button>
          }
        />
      </PageBody>
    </div>
  );

  if (!draftId) return expired;

  const result = await getConnectionDraft(draftId);
  if (!result.success) return expired;

  return (
    <div>
      <PageHeader
        title="Choose accounts"
        description="Pick the accounts this store should post from. You can change this later."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/social">
              <ArrowLeft className="size-4" />
              Back
            </Link>
          </Button>
        }
      />
      <PageBody>
        <ChooseAccountsClient draftId={draftId} candidates={result.data.candidates} />
      </PageBody>
    </div>
  );
}
