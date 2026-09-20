'use client';

/*
 * The list of discount codes.
 *
 * One row per code, with the two things a merchant actually wants at a
 * glance: whether it works right now, and what it has cost so far. Codes are
 * switched off rather than deleted once they've been used — see
 * `deleteDiscountCode`.
 */
import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, MoreHorizontal, Pencil, Plus, Power, Search, TicketPercent, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import {
  deleteDiscountCode,
  setDiscountCodeActive,
  type DiscountCodeRow,
} from '@/features/sales/discounts';
import { DiscountSheet } from './DiscountSheet';

/** What a code takes off, in the merchant's own words. */
export function discountValueLabel(code: Pick<DiscountCodeRow, 'kind' | 'value'>): string {
  return code.kind === 'PERCENT' ? `${formatNumber(code.value)}% off` : `${formatMoney(code.value)} off`;
}

/**
 * Whether a shopper typing this code today gets anything, and why not.
 *
 * The same four reasons the storefront applies (lib/storefront/discounts/
 * rules.ts), said the way a merchant would: a code can be perfectly valid
 * and still be doing nothing because it hasn't started or has run out.
 */
type StatusKey = 'live' | 'scheduled' | 'expired' | 'claimed' | 'off';

const STATUS: Record<StatusKey, { label: string; variant: 'success' | 'muted' | 'warning' | 'destructive' }> = {
  live: { label: 'Live', variant: 'success' },
  scheduled: { label: 'Scheduled', variant: 'warning' },
  claimed: { label: 'Fully claimed', variant: 'warning' },
  expired: { label: 'Expired', variant: 'destructive' },
  off: { label: 'Off', variant: 'muted' },
};

function statusOf(code: DiscountCodeRow, now: Date): StatusKey {
  if (!code.isActive) return 'off';
  if (code.endsAt && new Date(code.endsAt) < now) return 'expired';
  if (code.startsAt && new Date(code.startsAt) > now) return 'scheduled';
  if (code.usageLimit !== null && code.usageCount >= code.usageLimit) return 'claimed';
  return 'live';
}

const PAGE_SIZE = 20;

/** "1 Oct – 31 Oct 2026", "Until 31 Oct 2026", "From 1 Oct 2026", or "Always". */
function windowLabel(code: DiscountCodeRow): string {
  if (code.startsAt && code.endsAt) return `${formatDate(code.startsAt)} – ${formatDate(code.endsAt)}`;
  if (code.endsAt) return `Until ${formatDate(code.endsAt)}`;
  if (code.startsAt) return `From ${formatDate(code.startsAt)}`;
  return 'No end date';
}

function usageLabel(code: DiscountCodeRow): string {
  if (code.usageLimit === null) return formatNumber(code.usageCount, 0);
  return `${formatNumber(code.usageCount, 0)} of ${formatNumber(code.usageLimit, 0)}`;
}

export function DiscountsPageClient({
  codes,
  canManage,
}: {
  codes: DiscountCodeRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<DiscountCodeRow | null>(null);
  const [deleting, setDeleting] = React.useState<DiscountCodeRow | null>(null);
  const [pending, setPending] = React.useState(false);

  /* One clock for the whole table, taken on the client after mount: judging
   * "expired" on the server and again in the browser is how a row renders
   * two different badges. */
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => setNow(new Date()), []);

  /* Search, filter and page live in the URL, so a merchant can refresh,
   * bookmark or send someone the list they are looking at. */
  const query = searchParams.get('q') ?? '';
  const statusFilter = searchParams.get('status') ?? 'all';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      // Any change to what's being looked at starts again at the first page.
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return codes.filter((code) => {
      if (needle && !`${code.code} ${code.label}`.toLowerCase().includes(needle)) return false;
      if (statusFilter !== 'all' && now && statusOf(code, now) !== statusFilter) return false;
      return true;
    });
  }, [codes, query, statusFilter, now]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function open(code: DiscountCodeRow | null) {
    setEditing(code);
    setSheetOpen(true);
  }

  async function toggle(code: DiscountCodeRow) {
    const result = await setDiscountCodeActive(code.id, !code.isActive);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(code.isActive ? `${code.code} switched off` : `${code.code} switched on`);
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteDiscountCode(deleting.id);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Deleted ${deleting.code}`);
    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Discount codes"
        description="Codes customers type at checkout in your online store. Only the codes here work — there are no built-in ones."
        actions={
          canManage && codes.length > 0 ? (
            <Button size="sm" onClick={() => open(null)}>
              <Plus className="size-3.5" />
              New code
            </Button>
          ) : undefined
        }
      />

      {codes.length > 0 && (
        <PageToolbar>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search discount codes"
              placeholder="Search codes"
              defaultValue={query}
              onChange={(e) => setParams({ q: e.target.value })}
              className="pl-8"
            />
          </div>
          <SelectRoot value={statusFilter} onValueChange={(value) => setParams({ status: value === 'all' ? null : value })}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(STATUS) as StatusKey[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {STATUS[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </PageToolbar>
      )}

      <PageBody>
        {codes.length === 0 ? (
          <EmptyState
            icon={TicketPercent}
            title="No discount codes yet"
            description="A discount code takes a percentage or a fixed amount off a customer’s order when they type it at checkout. You decide what it gives, how long it runs and how many people can use it."
            action={
              canManage ? (
                <Button size="sm" onClick={() => open(null)}>
                  <Plus className="size-3.5" />
                  Create your first code
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Ask an admin to create discount codes.</p>
              )
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            variant="filtered"
            title="No codes match"
            description="Nothing here fits that search or status."
            action={
              <Button size="sm" variant="outline" onClick={() => setParams({ q: null, status: null })}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Code</TableColumnHeader>
                  <TableColumnHeader>Gives</TableColumnHeader>
                  <TableColumnHeader className="hidden md:table-cell">Runs</TableColumnHeader>
                  <TableColumnHeader align="right">Used</TableColumnHeader>
                  <TableColumnHeader align="right" className="hidden sm:table-cell">
                    Given away
                  </TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader>
                    <span className="sr-only">Actions</span>
                  </TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((code) => {
                  const state = now ? STATUS[statusOf(code, now)] : null;
                  return (
                    <TableRow
                      key={code.id}
                      clickable={canManage}
                      onClick={canManage ? () => open(code) : undefined}
                    >
                      <TableCell>
                        <p className="font-mono font-medium uppercase text-foreground">{code.code}</p>
                        <p className="truncate text-xs text-muted-foreground">{code.label}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-foreground">{discountValueLabel(code)}</p>
                        {code.minSubtotal !== null && (
                          <p className="text-xs text-muted-foreground">on orders over {formatMoney(code.minSubtotal)}</p>
                        )}
                      </TableCell>
                      <TableCell muted className="hidden md:table-cell">
                        {windowLabel(code)}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {usageLabel(code)}
                        {code.perCustomerLimit !== null && (
                          <p className="text-xs text-muted-foreground">
                            max {formatNumber(code.perCustomerLimit, 0)} per customer
                          </p>
                        )}
                      </TableCell>
                      <TableCell align="right" className="hidden tabular-nums sm:table-cell">
                        {code.totalDiscounted > 0 ? formatMoney(code.totalDiscounted) : '—'}
                      </TableCell>
                      <TableCell>
                        {state ? <Badge variant={state.variant}>{state.label}</Badge> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell align="right">
                        {canManage && (
                          <DropdownMenuRoot>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${code.code}`}>
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onSelect={() => open(code)}>
                                <Pencil />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void toggle(code)}>
                                <Power />
                                {code.isActive ? 'Switch off' : 'Switch on'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setDeleting(code)}
                              >
                                <Trash2 />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenuRoot>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filtered.length > PAGE_SIZE && (
              <TablePagination
                page={currentPage}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={PAGE_SIZE}
                onPageChange={(next) => setParams({ page: next === 1 ? null : String(next) })}
              />
            )}
          </TableWrapper>
        )}
      </PageBody>

      {canManage && (
        <>
          <DiscountSheet open={sheetOpen} onOpenChange={setSheetOpen} editing={editing} />
          <AlertDialogRoot open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {deleting?.code}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {deleting && deleting.usageCount > 0
                    ? `${deleting.code} has already been used, so it can’t be deleted — switch it off instead and it stops working immediately.`
                    : 'Customers who have this code will no longer be able to use it. This can’t be undone.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                {deleting && deleting.usageCount > 0 ? (
                  <Button
                    onClick={() => {
                      const code = deleting;
                      setDeleting(null);
                      void toggle(code);
                    }}
                  >
                    Switch it off
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={confirmDelete} disabled={pending}>
                    {pending && <Loader2 className="size-3.5 animate-spin" />}
                    Delete code
                  </Button>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialogRoot>
        </>
      )}
    </>
  );
}
