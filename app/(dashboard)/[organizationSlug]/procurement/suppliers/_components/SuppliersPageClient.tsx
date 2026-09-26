'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
  TableEmpty,
} from '@/components/ui/table';
import { SupplierDialog } from './SupplierDialog';
import type { SupplierRow } from '@/features/procurement/actions';
import { enumLabel } from '@/lib/format';

type SuppliersPageClientProps = {
  suppliers: SupplierRow[];
  canManage: boolean;
  /** Whether this plan includes the supplier performance report they open. */
  performanceEnabled: boolean;
  organizationSlug: string;
};

export function SuppliersPageClient({ suppliers, canManage, performanceEnabled, organizationSlug }: SuppliersPageClientProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SupplierRow | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(supplier: SupplierRow) {
    setEditing(supplier);
    setDialogOpen(true);
  }

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="The businesses you buy stock from."
        actions={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-3.5" />
              New supplier
            </Button>
          ) : undefined
        }
      />

      <PageBody className="space-y-4">
        {/* Not hidden, and not a dead row either: what the locked page would
            show, and where to see the plans (AGENTS §7). */}
        {!performanceEnabled && suppliers.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Supplier performance — how reliably each one delivers, and what their prices have done — is on Pro.{' '}
            <Link href="/upgrade" className="text-primary hover:underline">
              See plans
            </Link>
          </p>
        )}
        {suppliers.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No suppliers yet"
            description="Add the businesses you buy stock from, and you can raise purchase orders to them and see how reliably they deliver."
            action={
              canManage ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="size-3.5" />
                  New supplier
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Name</TableColumnHeader>
                  <TableColumnHeader>Contact</TableColumnHeader>
                  <TableColumnHeader align="right">Purchase orders</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader />
                </TableRow>
              </TableHead>
              <TableBody>
                {suppliers.length === 0 ? (
                  <TableEmpty colSpan={5} />
                ) : (
                  suppliers.map((s) => (
                    <TableRow
                      key={s.id}
                      clickable={performanceEnabled}
                      onClick={performanceEnabled ? () => router.push(`/procurement/suppliers/${s.id}`) : undefined}
                    >
                      <TableCell>
                        {performanceEnabled ? (
                          <Link
                            href={`/procurement/suppliers/${s.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="font-medium text-foreground hover:underline"
                          >
                            {s.name}
                          </Link>
                        ) : (
                          <span className="font-medium text-foreground">{s.name}</span>
                        )}
                        {s.taxId && <p className="text-xs text-muted-foreground">Tax ID: {s.taxId}</p>}
                      </TableCell>
                      <TableCell muted>
                        {s.email ?? '—'}
                        {s.phone ? ` · ${s.phone}` : ''}
                      </TableCell>
                      <TableCell align="right">{s.purchaseOrderCount}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === 'ACTIVE' ? 'success' : s.status === 'BLACKLISTED' ? 'destructive' : 'muted'}>
                          {enumLabel(s.status)}
                        </Badge>
                      </TableCell>
                      <TableCell align="right">
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(s);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </PageBody>

      <SupplierDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </>
  );
}
