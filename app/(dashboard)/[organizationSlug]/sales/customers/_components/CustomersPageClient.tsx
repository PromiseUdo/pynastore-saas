'use client';

import * as React from 'react';
import { Plus, Pencil, Users } from 'lucide-react';
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
import { CustomerDialog } from './CustomerDialog';
import type { CustomerRow } from '@/features/sales/actions';

type CustomersPageClientProps = {
  customers: CustomerRow[];
  canManage: boolean;
};

export function CustomersPageClient({ customers, canManage }: CustomersPageClientProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CustomerRow | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(customer: CustomerRow) {
    setEditing(customer);
    setDialogOpen(true);
  }

  return (
    <>
      <div className="flex items-center justify-between border-b bg-background px-6 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Customers</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Who you sell to.</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-3.5" />
            New customer
          </Button>
        )}
      </div>

      <div className="px-6 py-6">
        {customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
            <Users className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No customers yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">Add a customer to start creating quotes and invoices.</p>
          </div>
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Name</TableColumnHeader>
                  <TableColumnHeader>Contact</TableColumnHeader>
                  <TableColumnHeader align="right">Quotes</TableColumnHeader>
                  <TableColumnHeader align="right">Invoices</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader />
                </TableRow>
              </TableHead>
              <TableBody>
                {customers.length === 0 ? (
                  <TableEmpty colSpan={6} />
                ) : (
                  customers.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className="font-medium text-foreground">{c.name}</span>
                        {c.taxId && <p className="text-xs text-muted-foreground">Tax ID: {c.taxId}</p>}
                      </TableCell>
                      <TableCell muted>
                        {c.email ?? '—'}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </TableCell>
                      <TableCell align="right">{c.quoteCount}</TableCell>
                      <TableCell align="right">{c.invoiceCount}</TableCell>
                      <TableCell>
                        <Badge variant={c.status === 'ACTIVE' ? 'success' : 'muted'}>{c.status}</Badge>
                      </TableCell>
                      <TableCell align="right">
                        {canManage && (
                          <Button variant="ghost" size="icon-sm" onClick={() => openEdit(c)}>
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

      <CustomerDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </>
  );
}
