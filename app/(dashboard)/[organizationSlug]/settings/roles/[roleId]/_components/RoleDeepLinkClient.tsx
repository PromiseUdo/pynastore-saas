'use client';

import * as React from 'react';
import { RolesPageClient } from '../../_components/RolesPageClient';
import { EditRoleSheet } from '../../_components/EditRoleSheet';
import type { RoleWithDetails } from '@/features/roles/actions';

type Props = {
  roles: RoleWithDetails[];
  targetRole: RoleWithDetails;
  callerPermissions: string[];
  organizationSlug: string;
};

export function RoleDeepLinkClient({
  roles,
  targetRole,
  callerPermissions,
  organizationSlug,
}: Props) {
  const [sheetOpen, setSheetOpen] = React.useState(true);

  return (
    <>
      <RolesPageClient
        roles={roles}
        callerPermissions={callerPermissions}
        organizationSlug={organizationSlug}
      />
      <EditRoleSheet
        role={targetRole}
        callerPermissions={callerPermissions}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}
