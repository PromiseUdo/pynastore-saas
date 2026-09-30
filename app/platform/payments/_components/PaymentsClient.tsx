'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogRoot,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber, formatRelativeTime } from '@/lib/format';
import {
  checkStuckPayment,
  markPaymentReviewed,
  resolveUnmatchedPayment,
  type PaymentPage,
} from '@/features/platform/payments';
import { checkSubaccount, retrySubaccount } from '@/features/platform/verification';
import { SETUP_LABEL, SETUP_VARIANT } from '../../verification/labels';

const DISPUTE_STATUS: Record<string, string> = {
  'awaiting-merchant-feedback': 'Waiting for a response',
  'awaiting-bank-feedback': 'Waiting for the bank',
  pending: 'Being reviewed',
};

const ORDER_STATUS: Record<string, string> = {
  PENDING: 'Waiting for payment',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Being prepared',
  SHIPPED: 'Sent',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const EXPLAIN: Record<PaymentPage['tab'], string> = {
  mismatched:
    'Paystack says these were paid, but not the amount we asked for, or not to the shop’s own subaccount. They were NOT treated as payment. Look each up in Paystack, sort it out with the merchant, then mark it reviewed.',
  unmatched:
    'Payments and chargebacks Paystack sent us whose reference is nothing of ours — not a shop payment, not a subscription. Nothing was credited. Find out what each is in Paystack’s dashboard, then mark it dealt with.',
  disputes:
    'Chargebacks still open, soonest deadline first. Respond in Paystack’s dashboard; the shop’s staff were emailed and see it on the order. Who bears a lost chargeback is still to be confirmed with Paystack.',
  payouts:
    'Approved businesses whose Paystack payout account needs attention — Paystack refused it, or switched it off. They can’t take online payments until it’s fixed.',
  stuck:
    'Online payments that never confirmed, past the one-hour hold, in the last 30 days. Most are shoppers who never reached Paystack. “Check with Paystack” settles any that were paid and closes the ones Paystack never saw.',
};

export function PaymentsClient({ data }: { data: PaymentPage }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const now = new Date();

  const go = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (page > 1) params.set('page', String(page));
    else params.delete('page');
    router.push(`${pathname}?${params}`);
  };

  const c = data.counts;
  const tabs = [
    { key: 'mismatched', label: `Mismatched (${formatNumber(c.mismatched)})` },
    { key: 'unmatched', label: `Unmatched (${formatNumber(c.unmatched)})` },
    { key: 'disputes', label: `Disputes (${formatNumber(c.disputes)})` },
    { key: 'payouts', label: `Payout setup (${formatNumber(c.payouts)})` },
    { key: 'stuck', label: `Stuck (${formatNumber(c.stuck)})` },
  ];

  return (
    <div className="space-y-4">
      <div className="border-b">
        <PageTabs tabs={tabs} current={data.tab} param="tab" />
      </div>
      <p className="text-xs text-muted-foreground">{EXPLAIN[data.tab]}</p>

      {data.rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nothing here" description="When something needs looking into, it appears here." />
      ) : (
        <>
          {data.tab === 'stuck' && <StuckTable rows={data.rows} now={now} />}
          {data.tab === 'mismatched' && <MismatchTable rows={data.rows} now={now} />}
          {data.tab === 'unmatched' && <UnmatchedTable rows={data.rows} now={now} />}
          {data.tab === 'disputes' && <DisputeTable rows={data.rows} now={now} />}
          {data.tab === 'payouts' && <PayoutTable rows={data.rows} now={now} />}
          {data.total > data.pageSize && (
            <TablePagination
              page={data.page}
              totalPages={Math.ceil(data.total / data.pageSize)}
              totalItems={data.total}
              pageSize={data.pageSize}
              onPageChange={go}
            />
          )}
        </>
      )}
    </div>
  );
}

const Shop = ({ shop }: { shop: { id: string; name: string } }) => (
  <Link href={`/platform/merchants/${shop.id}`} className="font-medium text-foreground hover:underline">
    {shop.name}
  </Link>
);
const Ref = ({ value }: { value: string }) => <span className="block break-all font-mono text-[11px] text-muted-foreground">{value}</span>;

type Rows<T extends PaymentPage['tab']> = Extract<PaymentPage, { tab: T }>['rows'];

function StuckTable({ rows, now }: { rows: Rows<'stuck'>; now: Date }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function check(ids: string[]) {
    for (const id of ids) {
      setBusy(id);
      const r = await checkStuckPayment(id);
      if (!r.success) toast.error(r.error);
      else if (ids.length === 1) toast.message(r.data.message);
    }
    setBusy(null);
    if (ids.length > 1) toast.success(`Checked ${ids.length} with Paystack`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => check(rows.map((r) => r.id))}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Check all on this page
        </Button>
      </div>
      <TableWrapper>
        <Table>
          <TableHead>
            <TableRow>
              <TableColumnHeader>Shop</TableColumnHeader>
              <TableColumnHeader>Order</TableColumnHeader>
              <TableColumnHeader align="right">Amount</TableColumnHeader>
              <TableColumnHeader>Started</TableColumnHeader>
              <TableColumnHeader>
                <span className="sr-only">Actions</span>
              </TableColumnHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Shop shop={r.shop} />
                </TableCell>
                <TableCell>
                  {r.orderReference}
                  <span className="block text-xs text-muted-foreground">{ORDER_STATUS[r.orderStatus] ?? '—'}</span>
                  <Ref value={r.reference} />
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {formatMoney(r.amount)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDate(r.createdAt)}>
                  {formatRelativeTime(r.createdAt, now)}
                </TableCell>
                <TableCell align="right">
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => check([r.id])}>
                    {busy === r.id && <Loader2 className="size-3.5 animate-spin" />}
                    Check with Paystack
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>
    </div>
  );
}

function MismatchTable({ rows, now }: { rows: Rows<'mismatched'>; now: Date }) {
  const [reviewing, setReviewing] = React.useState<string | null>(null);
  return (
    <>
      <TableWrapper>
        <Table>
          <TableHead>
            <TableRow>
              <TableColumnHeader>Shop</TableColumnHeader>
              <TableColumnHeader>Order</TableColumnHeader>
              <TableColumnHeader align="right">Asked for</TableColumnHeader>
              <TableColumnHeader align="right">Paystack reported</TableColumnHeader>
              <TableColumnHeader>Subaccount</TableColumnHeader>
              <TableColumnHeader>
                <span className="sr-only">Actions</span>
              </TableColumnHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const wrongSub = r.reportedSubaccount !== r.expectedSubaccount;
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <Shop shop={r.shop} />
                    <span className="block text-xs text-muted-foreground" title={r.verifiedAt ? formatDate(r.verifiedAt) : undefined}>
                      {r.verifiedAt ? formatRelativeTime(r.verifiedAt, now) : '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.orderReference}
                    <Ref value={r.reference} />
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {formatMoney(r.amount)}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {r.reportedAmount === null ? '—' : formatMoney(r.reportedAmount)}
                    {r.reportedCurrency && r.reportedCurrency !== 'NGN' && <span className="block text-xs text-destructive">{r.reportedCurrency}</span>}
                    {r.platformShare ? <span className="block text-xs text-destructive">{formatMoney(r.platformShare)} to the platform</span> : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="block font-mono">expected {r.expectedSubaccount ?? '—'}</span>
                    <span className={wrongSub ? 'block font-mono text-destructive' : 'block font-mono text-muted-foreground'}>
                      got {r.reportedSubaccount ?? 'none'}
                    </span>
                  </TableCell>
                  <TableCell align="right">
                    <Button variant="outline" size="sm" onClick={() => setReviewing(r.id)}>
                      Mark reviewed
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableWrapper>
      <NoteDialog
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
        title="Mark this mismatch reviewed"
        description="Say what you found and what was done. It stays on the payment; nothing about the payment or the order changes."
        action="Mark reviewed"
        submit={(note) => markPaymentReviewed(reviewing!, note)}
      />
    </>
  );
}

function UnmatchedTable({ rows, now }: { rows: Rows<'unmatched'>; now: Date }) {
  const [resolving, setResolving] = React.useState<string | null>(null);
  return (
    <>
      <TableWrapper>
        <Table>
          <TableHead>
            <TableRow>
              <TableColumnHeader>What</TableColumnHeader>
              <TableColumnHeader>Reference</TableColumnHeader>
              <TableColumnHeader align="right">Amount</TableColumnHeader>
              <TableColumnHeader>Paid to</TableColumnHeader>
              <TableColumnHeader>Received</TableColumnHeader>
              <TableColumnHeader>
                <span className="sr-only">Actions</span>
              </TableColumnHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge variant={r.kind === 'dispute' ? 'destructive' : 'warning'}>{r.kind === 'dispute' ? 'Chargeback' : 'Payment'}</Badge>
                  {r.customerEmail && <span className="block text-xs text-muted-foreground">{r.customerEmail}</span>}
                </TableCell>
                <TableCell>
                  <Ref value={r.reference} />
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {r.amount === null ? '—' : formatMoney(r.amount, r.currency ?? 'NGN')}
                </TableCell>
                <TableCell className="text-xs">
                  {r.shop ? <Shop shop={r.shop} /> : <span className="text-muted-foreground">{r.subaccountCode ? `${r.subaccountCode} (not one of ours)` : 'The platform account'}</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDate(r.createdAt)}>
                  {formatRelativeTime(r.createdAt, now)}
                </TableCell>
                <TableCell align="right">
                  <Button variant="outline" size="sm" onClick={() => setResolving(r.id)}>
                    Mark dealt with
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>
      <NoteDialog
        open={resolving !== null}
        onClose={() => setResolving(null)}
        title="Mark this dealt with"
        description="Say what it turned out to be and what was done. It leaves this list."
        action="Mark dealt with"
        submit={(note) => resolveUnmatchedPayment(resolving!, note)}
      />
    </>
  );
}

function DisputeTable({ rows, now }: { rows: Rows<'disputes'>; now: Date }) {
  return (
    <TableWrapper>
      <Table>
        <TableHead>
          <TableRow>
            <TableColumnHeader>Shop</TableColumnHeader>
            <TableColumnHeader>Order</TableColumnHeader>
            <TableColumnHeader align="right">Amount</TableColumnHeader>
            <TableColumnHeader>Status</TableColumnHeader>
            <TableColumnHeader>Respond by</TableColumnHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((d) => {
            const overdue = d.dueAt && new Date(d.dueAt) < now;
            return (
              <TableRow key={d.id}>
                <TableCell>
                  <Shop shop={d.shop} />
                </TableCell>
                <TableCell>
                  {d.orderReference}
                  <Ref value={d.paymentReference} />
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {formatMoney(d.amount, d.currency)}
                </TableCell>
                <TableCell>
                  <Badge variant="pending">{DISPUTE_STATUS[d.status] ?? 'Open'}</Badge>
                  {d.category && <span className="block text-xs capitalize text-muted-foreground">{d.category}</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {d.dueAt ? (
                    <Badge variant={overdue ? 'overdue' : 'warning'} >
                      {formatDate(d.dueAt)}
                    </Badge>
                  ) : (
                    '—'
                  )}
                  {d.dueAt && <span className="block text-xs text-muted-foreground">{formatRelativeTime(d.dueAt, now)}</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableWrapper>
  );
}

function PayoutTable({ rows, now }: { rows: Rows<'payouts'>; now: Date }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(orgId: string, kind: 'retry' | 'check') {
    setBusy(`${kind}:${orgId}`);
    const r = kind === 'retry' ? await retrySubaccount(orgId) : await checkSubaccount(orgId);
    setBusy(null);
    if (!r.success) return toast.error(r.error);
    toast.success(kind === 'retry' ? 'Payouts are set up' : 'Checked with Paystack');
    router.refresh();
  }

  return (
    <TableWrapper>
      <Table>
        <TableHead>
          <TableRow>
            <TableColumnHeader>Shop</TableColumnHeader>
            <TableColumnHeader>Status</TableColumnHeader>
            <TableColumnHeader>What Paystack said</TableColumnHeader>
            <TableColumnHeader>
              <span className="sr-only">Actions</span>
            </TableColumnHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.shop.id}>
              <TableCell>
                <Shop shop={a.shop} />
                {a.businessName && <span className="block text-xs text-muted-foreground">{a.businessName}</span>}
              </TableCell>
              <TableCell>
                <Badge variant={SETUP_VARIANT[a.setupStatus as keyof typeof SETUP_VARIANT] ?? 'warning'}>
                  {SETUP_LABEL[a.setupStatus as keyof typeof SETUP_LABEL] ?? '—'}
                </Badge>
                <span className="block text-xs text-muted-foreground">since {formatRelativeTime(a.updatedAt, now)}</span>
              </TableCell>
              <TableCell className="max-w-sm text-xs text-muted-foreground">{a.setupError ?? '—'}</TableCell>
              <TableCell align="right">
                <div className="flex justify-end gap-2">
                  <Link href={`/platform/verification/${a.shop.id}`} className="text-xs text-primary hover:underline">
                    Details
                  </Link>
                  {a.setupStatus === 'ACTION_REQUIRED' && (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(a.shop.id, 'retry')}>
                      {busy === `retry:${a.shop.id}` && <Loader2 className="size-3.5 animate-spin" />}
                      Retry creating subaccount
                    </Button>
                  )}
                  {a.subaccountCode && (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run(a.shop.id, 'check')}>
                      {busy === `check:${a.shop.id}` && <Loader2 className="size-3.5 animate-spin" />}
                      Check with Paystack
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrapper>
  );
}

function NoteDialog({
  open,
  onClose,
  title,
  description,
  action,
  submit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  action: string;
  submit: (note: string) => Promise<{ success: true } | { success: false; error: string }>;
}) {
  const router = useRouter();
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <AlertDialogRoot
      open={open}
      onOpenChange={(o) => {
        if (pending || o) return;
        onClose();
        setNote('');
        setError(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="staff-note">
            What you found <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="staff-note"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'staff-note-error' : undefined}
          />
          {error && (
            <p id="staff-note-error" role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={async (e) => {
              e.preventDefault();
              setPending(true);
              const r = await submit(note);
              setPending(false);
              if (!r.success) return setError(r.error);
              toast.success('Saved');
              onClose();
              setNote('');
              setError(null);
              router.refresh();
            }}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>
  );
}
