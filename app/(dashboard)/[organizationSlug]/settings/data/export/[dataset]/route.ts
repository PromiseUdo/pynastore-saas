/*
 * GET /settings/data/export/{customers|products|orders|invoices} — one of the
 * workspace's record sets as a CSV file (ROADMAP 13.8). Owners only: the
 * customer list is everyone's contact details.
 */
import { getOrganizationContext } from '@/lib/organization';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { csvFilename } from '@/lib/csv';
import { isWorkspaceDataset, workspaceCsv, WORKSPACE_DATASETS } from '@/lib/data-rights/workspace-export';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await params;
  if (!isWorkspaceDataset(dataset)) return new Response('Not found.', { status: 404 });
  const ctx = await getOrganizationContext();
  const role = ctx.membership.role;
  if (!(role.isSystem && role.name === SYSTEM_ROLES.OWNER.name)) {
    return new Response('Only an Owner can download the workspace’s data.', { status: 403 });
  }
  const csv = await workspaceCsv(ctx.organization.id, dataset);
  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(WORKSPACE_DATASETS[dataset])}"`,
      'Cache-Control': 'no-store',
    },
  });
}
