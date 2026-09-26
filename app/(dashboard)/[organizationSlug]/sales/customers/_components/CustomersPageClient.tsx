'use client';

/*
 * The customer list.
 *
 * It used to show a name, a contact and a count of quotes and invoices —
 * true, and no use. A shop owner looking at this list is asking one of three
 * questions: who are my best customers, who has stopped coming back, and who
 * is this person who just walked in. The columns, the segments and the search
 * are those three questions.
 *
 * Segments are URL filters rather than saved lists: they cost nothing to
 * offer, they can be bookmarked, and none of them can go stale.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Plus, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { ExportCsvButton } from '@/components/dashboard/export-csv-button';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber, formatRelativeTime } from '@/lib/format';
import { exportCustomerInsights, type CustomerListResult, type CustomerListRow } from '@/features/sales/customer-insights';
import { CUSTOMER_SEGMENTS, CUSTOMER_SORTS } from '@/lib/sales/customer-segments';
import { CustomerDialog } from './CustomerDialog';

export function CustomersPageClient({
  list,
  currency,
  canManage,
  canCreate,
}: {
  list: CustomerListResult;
  currency: string;
  canManage: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const now = React.useMemo(() => new Date(), []);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const segment = searchParams.get('segment') ?? 'all';
  const sort = searchParams.get('sort') ?? 'spend';
  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = React.useState(urlQuery);

  const money = (value: number) => formatMoney(value, currency);

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '' || value === 'all') next.delete(key);
        else next.set(key, value);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => setParams({ q: query }), 350);
    return () => clearTimeout(timer);
  }, [query, urlQuery, setParams]);

  const filtered = segment !== 'all' || urlQuery !== '';
  /* Say what the chosen segment means — nobody should have to guess what
   * "gone quiet" counts as. */
  const segmentHint = CUSTOMER_SEGMENTS.find((s) => s.key === segment)?.hint ?? null;

  const fetchExport = React.useCallback(
    () => exportCustomerInsights({ q: urlQuery || undefined, segment, sort }),
    [urlQuery, segment, sort],
  );

  const newCustomerButton = canCreate ? (
    <Button size="sm" onClick={() => setDialogOpen(true)}>
      <Plus className="size-3.5" />
      New customer
    </Button>
  ) : undefined;

  const header = (
    <PageHeader
      title="Customers"
      description="Who you sell to, what they spend, and when they were last here."
      actions={
        <>
          <ExportCsvButton
            fetchRows={fetchExport}
            columns={CSV_COLUMNS}
            name="customers"
            disabled={list.historySize === 0}
          />
          {newCustomerButton}
        </>
      }
    />
  );

  if (list.historySize === 0) {
    return (
      <>
        {header}
        <PageBody>
          <EmptyState
            icon={Users}
            title="No customers yet"
            description="Anyone who buys from your online store is added here automatically. You can also add one by hand for quotes and invoices."
            action={newCustomerButton}
          />
        </PageBody>
        <CustomerDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={null} />
      </>
    );
  }

  return (
    <>
      {header}

      {/* The whole customer base, not this page — so the numbers don't jump
        * around as you filter. */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-b bg-background px-6 pb-3 text-sm">
        <Figure label="Customers" value={formatNumber(list.summary.customers)} />
        <Figure label="Have ordered" value={formatNumber(list.summary.withOrders)} />
        <Figure label="Repeat customers" value={formatNumber(list.summary.repeat)} />
        <Figure label="Lifetime sales" value={money(list.summary.totalSpend)} />
      </div>

      {/* PageToolbar, like every other tabbed page: its `py-2.5` is exactly
        * what PageTabs' `-mb-2.5` pulls back, so the active tab's underline
        * lands ON the toolbar's bottom border instead of below it. */}
      <PageToolbar className="gap-y-2">
        <PageTabs tabs={[...CUSTOMER_SEGMENTS]} current={segment} param="segment" />
      </PageToolbar>

      <PageToolbar>
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email or phone"
            aria-label="Search customers"
            className="pl-8"
          />
        </div>

        <SelectRoot value={sort} onValueChange={(value) => setParams({ sort: value })}>
          <SelectTrigger className="w-48" aria-label="Sort customers">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CUSTOMER_SORTS.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>

        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('');
              setParams({ q: null, segment: null });
            }}
          >
            Clear filters
          </Button>
        )}
      </PageToolbar>

      {segmentHint && (
        <p className="border-b bg-muted/30 px-6 py-2 text-xs text-muted-foreground">{segmentHint}</p>
      )}

      <PageBody>
        {list.rows.length === 0 ? (
          <EmptyState
            variant="filtered"
            icon={Users}
            title="Nobody matches"
            description="Try a different search, or another segment."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setParams({ q: null, segment: null });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Customer</TableColumnHeader>
                    <TableColumnHeader align="right">Orders</TableColumnHeader>
                    <TableColumnHeader align="right">Spent</TableColumnHeader>
                    <TableColumnHeader align="right">Average order</TableColumnHeader>
                    <TableColumnHeader>Last order</TableColumnHeader>
                    <TableColumnHeader>Labels</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {list.rows.map((customer) => (
                    <TableRow
                      key={customer.id}
                      clickable
                      onClick={() => router.push(`/sales/customers/${customer.id}`)}
                    >
                      <TableCell>
                        <Link
                          href={`/sales/customers/${customer.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-medium text-foreground hover:underline"
                        >
                          {customer.name}
                        </Link>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {[customer.email, customer.phone].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {customer.orderCount > 0 ? formatNumber(customer.orderCount) : '—'}
                      </TableCell>
                      <TableCell align="right" className="font-medium tabular-nums">
                        {customer.orderCount > 0 ? money(customer.totalSpend) : '—'}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums text-muted-foreground">
                        {customer.orderCount > 0 ? money(customer.averageOrder) : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {customer.lastOrderAt ? (
                          <span title={formatDate(customer.lastOrderAt)}>
                            {formatRelativeTime(customer.lastOrderAt, now)}
                          </span>
                        ) : (
                          'Never'
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          {customer.returnCount > 0 && (
                            <Badge variant="warning">
                              {customer.returnCount === 1 ? '1 return' : `${customer.returnCount} returns`}
                            </Badge>
                          )}
                          {customer.tags.slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="muted">
                              {tag}
                            </Badge>
                          ))}
                          {customer.tags.length > 2 && (
                            <Badge variant="muted">+{customer.tags.length - 2}</Badge>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {list.pageCount > 1 && (
                <TablePagination
                  page={list.page}
                  totalPages={list.pageCount}
                  totalItems={list.total}
                  pageSize={list.perPage}
                  onPageChange={(next) => setParams({ page: String(next) })}
                />
              )}
            </TableWrapper>
          </>
        )}
      </PageBody>

      <CustomerDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={null} />
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

const CSV_COLUMNS = [
  { header: 'Name', value: (row: CustomerListRow) => row.name },
  { header: 'Email', value: (row: CustomerListRow) => row.email ?? '' },
  { header: 'Phone', value: (row: CustomerListRow) => row.phone ?? '' },
  { header: 'Orders', value: (row: CustomerListRow) => row.orderCount },
  { header: 'Total spent', value: (row: CustomerListRow) => row.totalSpend },
  { header: 'Average order', value: (row: CustomerListRow) => Math.round(row.averageOrder * 100) / 100 },
  { header: 'Last order', value: (row: CustomerListRow) => row.lastOrderAt ?? '' },
  { header: 'Returns', value: (row: CustomerListRow) => row.returnCount },
  { header: 'Agreed to marketing', value: (row: CustomerListRow) => (row.marketingConsent ? 'Yes' : 'No') },
  { header: 'Labels', value: (row: CustomerListRow) => row.tags.join(', ') },
  { header: 'Added', value: (row: CustomerListRow) => row.createdAt },
];
