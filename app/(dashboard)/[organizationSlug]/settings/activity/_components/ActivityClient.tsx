'use client';

/*
 * The activity table.
 *
 * One row per thing that happened: who, what, which record, and when. The
 * action key is never shown raw — lib/audit-labels.ts turns it into a
 * sentence, and the same helper writes the spreadsheet, so the two always
 * agree.
 *
 * Filters and the page number are written to the URL and read back by the
 * server, so a view can be refreshed, bookmarked or sent to a colleague.
 * This component only ever holds the page it was given.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { History, Lock, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
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
import { formatDate, formatRelativeTime } from '@/lib/format';
import { PLATFORM_NAME } from '@/lib/brand';
import { AUDIT_AREAS, auditActionLabel, auditEntityLabel } from '@/lib/audit-labels';
import { exportActivity, type ActivityResult, type ActivityRow } from '@/features/settings/activity';

const CSV_COLUMNS = [
  { header: 'When', value: (row: ActivityRow) => row.createdAt },
  { header: 'Member', value: (row: ActivityRow) => row.actorName ?? PLATFORM_NAME },
  { header: 'Email', value: (row: ActivityRow) => row.actorEmail ?? '' },
  { header: 'What happened', value: (row: ActivityRow) => auditActionLabel(row.action) },
  { header: 'Action key', value: (row: ActivityRow) => row.action },
  { header: 'Record type', value: (row: ActivityRow) => auditEntityLabel(row.entityType) },
  { header: 'Record ID', value: (row: ActivityRow) => row.entityId },
  { header: 'IP address', value: (row: ActivityRow) => row.ipAddress ?? '' },
];

export function ActivityClient({ result }: { result: ActivityResult }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const now = React.useMemo(() => new Date(), []);

  const member = searchParams.get('member') ?? 'all';
  const area = searchParams.get('area') ?? 'all';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = React.useState(urlQuery);

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '' || value === 'all') next.delete(key);
        else next.set(key, value);
      }
      // Any change to what's being looked at starts again at the first page.
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  /* Typing shouldn't hit the database on every keystroke, and it shouldn't
   * push a history entry per character either — hence replace(), debounced. */
  React.useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => setParams({ q: query }), 350);
    return () => clearTimeout(timer);
  }, [query, urlQuery, setParams]);

  const filtered = member !== 'all' || area !== 'all' || from !== '' || to !== '' || urlQuery !== '';

  /* The download is every row the filters match, not the page on screen, so
   * it is fetched at click time with the filters that are in the URL now. */
  const fetchExport = React.useCallback(
    () =>
      exportActivity({
        memberId: member === 'all' ? undefined : member,
        area: area === 'all' ? undefined : area,
        q: urlQuery || undefined,
        from: from ? new Date(`${from}T00:00:00`) : undefined,
        to: to ? new Date(`${to}T23:59:59.999`) : undefined,
      }),
    [member, area, urlQuery, from, to],
  );

  const header = (
    <PageHeader
      title="Activity"
      description="Who changed what in this workspace, newest first."
      actions={
        result.canExport ? (
          <ExportCsvButton
            fetchRows={fetchExport}
            columns={CSV_COLUMNS}
            name="activity"
            label="Download CSV"
            disabled={result.historySize === 0}
          />
        ) : (
          /* A plan-gated feature is shown with a way to get it, never hidden
           * from the page (AGENTS §7). */
          <Button asChild variant="outline" size="sm">
            <Link href="/upgrade">
              <Lock className="size-3.5" />
              Download on Pro
            </Link>
          </Button>
        )
      }
    />
  );

  /* No activity at all is a different message from "your filters hid it". */
  if (result.historySize === 0) {
    return (
      <div>
        {header}
        <PageBody>
          <EmptyState
            icon={History}
            title="Nothing has happened yet"
            description="As you and your team work — adding products, approving orders, changing settings — every change is recorded here."
          />
        </PageBody>
      </div>
    );
  }

  return (
    <div>
      {header}

      <PageToolbar>
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by record ID"
            aria-label="Search activity"
            className="pl-8"
          />
        </div>

        <SelectRoot value={member} onValueChange={(value) => setParams({ member: value })}>
          <SelectTrigger className="w-44" aria-label="Filter by member">
            <SelectValue placeholder="Everyone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            {result.members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>

        <SelectRoot value={area} onValueChange={(value) => setParams({ area: value })}>
          <SelectTrigger className="w-40" aria-label="Filter by area">
            <SelectValue placeholder="All areas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All areas</SelectItem>
            {AUDIT_AREAS.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>

        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setParams({ from: event.target.value })}
            aria-label="From date"
            className="w-36"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setParams({ to: event.target.value })}
            aria-label="Until date"
            className="w-36"
          />
        </div>

        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('');
              setParams({ q: null, member: null, area: null, from: null, to: null });
            }}
          >
            Clear filters
          </Button>
        )}
      </PageToolbar>

      <PageBody>
        {result.rows.length === 0 ? (
          <EmptyState
            variant="filtered"
            icon={History}
            title="No activity matches those filters"
            description="Try a wider date range, or a different member."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setParams({ q: null, member: null, area: null, from: null, to: null });
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
                    <TableColumnHeader>When</TableColumnHeader>
                    <TableColumnHeader>Member</TableColumnHeader>
                    <TableColumnHeader>What happened</TableColumnHeader>
                    <TableColumnHeader>Record</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">
                        <span title={formatDate(row.createdAt)}>{formatRelativeTime(row.createdAt, now)}</span>
                      </TableCell>
                      <TableCell>
                        {row.actorName ? (
                          <span className="font-medium text-foreground">{row.actorName}</span>
                        ) : (
                          /* No user means the app itself did it — a payment
                           * webhook, or a scheduled job. Saying so is better
                           * than an empty cell. */
                          <span className="text-muted-foreground">{PLATFORM_NAME}</span>
                        )}
                      </TableCell>
                      <TableCell>{auditActionLabel(row.action)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="text-xs">
                          {auditEntityLabel(row.entityType)}
                          <span className="ml-1.5 font-mono text-[11px] opacity-60">{row.entityId}</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {result.pageCount > 1 && (
                <TablePagination
                  page={result.page}
                  totalPages={result.pageCount}
                  totalItems={result.total}
                  pageSize={result.perPage}
                  onPageChange={(next) => setParams({ page: String(next) })}
                />
              )}
            </TableWrapper>
          </>
        )}
      </PageBody>
    </div>
  );
}
