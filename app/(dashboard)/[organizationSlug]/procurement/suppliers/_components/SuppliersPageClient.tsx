'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

type SuppliersPageClientProps = {
  suppliers: SupplierRow[];
  canManage: boolean;
  organizationSlug: string;
};

export function SuppliersPageClient({ suppliers, canManage, organizationSlug }: SuppliersPageClientProps) {
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
      <div className="flex items-center justify-between border-b bg-background px-6 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Suppliers</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Vendors you purchase inventory from.</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-3.5" />
            New supplier
          </Button>
        )}
      </div>

      <div className="px-6 py-6">
        {suppliers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
            <Building2 className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No suppliers yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">Add a supplier to start creating purchase orders.</p>
          </div>
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
                      clickable
                      onClick={() => router.push(`/procurement/suppliers/${s.id}`)}
                    >
                      <TableCell>
                        <span className="font-medium text-foreground">{s.name}</span>
                        {s.taxId && <p className="text-xs text-muted-foreground">Tax ID: {s.taxId}</p>}
                      </TableCell>
                      <TableCell muted>
                        {s.email ?? '—'}
                        {s.phone ? ` · ${s.phone}` : ''}
                      </TableCell>
                      <TableCell align="right">{s.purchaseOrderCount}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === 'ACTIVE' ? 'success' : s.status === 'BLACKLISTED' ? 'destructive' : 'muted'}>
                          {s.status}
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
      </div>

      <SupplierDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </>
  );
}
