'use client';

import * as React from 'react';
import { Plus, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { RoleCard } from './RoleCard';
import { CreateRoleDialog } from './CreateRoleDialog';
import type { RoleWithDetails } from '@/features/roles/actions';

type RolesPageClientProps = {
  roles: RoleWithDetails[];
  callerPermissions: string[];
  organizationSlug: string;
};

export function RolesPageClient({
  roles,
  callerPermissions,
  organizationSlug,
}: RolesPageClientProps) {
  const [createOpen, setCreateOpen] = React.useState(false);

  const systemRoles = roles.filter((r) => r.isSystem);
  const customRoles = roles.filter((r) => !r.isSystem);

  return (
    <>
      {/* Page header */}
      <div className="flex items-center justify-between border-b bg-background px-6 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Roles &amp; permissions
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Define what each role can do in your organization.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" />
          New role
        </Button>
      </div>

      <div className="space-y-8 px-6 py-6">
        {/* System roles section */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            System roles
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Built-in roles that ship with every organization. Permissions can be
            edited but system roles cannot be deleted or removed.
          </p>
          <div className="space-y-3">
            {systemRoles.map((role) => (
              <RoleCard
                key={role.id}
                role={role}
                callerPermissions={callerPermissions}
                organizationSlug={organizationSlug}
              />
            ))}
          </div>
        </section>

        <Separator />

        {/* Custom roles section */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Custom roles
          </h2>

          {customRoles.length === 0 ? (
            <EmptyCustomRoles onCreateClick={() => setCreateOpen(true)} />
          ) : (
            <div className="space-y-3">
              {customRoles.map((role) => (
                <RoleCard
                  key={role.id}
                  role={role}
                  callerPermissions={callerPermissions}
                  organizationSlug={organizationSlug}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        callerPermissions={callerPermissions}
        existingRoles={roles}
      />
    </>
  );
}

function EmptyCustomRoles({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
        <ShieldOff className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">No custom roles yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Create a role tailored to your team&apos;s specific needs.
      </p>
      <Button size="sm" className="mt-4" onClick={onCreateClick}>
        <Plus className="size-3.5" />
        Create your first role
      </Button>
    </div>
  );
}
