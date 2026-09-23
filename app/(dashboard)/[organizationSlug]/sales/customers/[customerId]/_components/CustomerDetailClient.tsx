'use client';

/*
 * The customer page.
 *
 * Laid out the way the questions get asked: what are they worth (the figures
 * across the top), what have they bought (the history, which is most of the
 * page), and what do I need to remember about them (the column on the right,
 * where the things a merchant edits live together).
 *
 * Everything shown is something the business recorded. The return rate is a
 * ratio of their own orders; "0 returns" is only ever shown to someone who
 * has actually ordered, because a perfect record nobody earned is a lie with
 * a friendly face.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ChevronLeft,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Receipt,
  ShoppingBag,
  Star,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription } from '@/components/ui/form-field';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
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
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { enumLabel, formatDate, formatMoney, formatNumber, formatRelativeTime } from '@/lib/format';
import {
  ORDER_CHANNEL_LABEL,
  ORDER_CHANNEL_VARIANT,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_VARIANT,
} from '@/lib/sales/order-labels';
import {
  mergeCustomers,
  setMarketingConsent,
  updateCustomerNotes,
  type CustomerDetail,
  type MergeCandidate,
} from '@/features/sales/customer-detail';

const MERGE_REASON: Record<MergeCandidate['reason'], string> = {
  phone: 'same phone number',
  email: 'same email address',
  name: 'same name',
};

export function CustomerDetailClient({
  customer,
  currency,
  canManage,
  duplicates,
}: {
  customer: CustomerDetail;
  currency: string;
  canManage: boolean;
  duplicates: MergeCandidate[];
}) {
  const router = useRouter();
  const now = React.useMemo(() => new Date(), []);
  const money = (value: number) => formatMoney(value, currency);

  const [notes, setNotes] = React.useState(customer.notes ?? '');
  const [tagInput, setTagInput] = React.useState('');
  const [tags, setTags] = React.useState<string[]>(customer.tags);
  const [savingNotes, setSavingNotes] = React.useState(false);
  const [merging, setMerging] = React.useState<MergeCandidate | null>(null);
  const [mergePending, setMergePending] = React.useState(false);

  const notesDirty = notes !== (customer.notes ?? '') || tags.join('|') !== customer.tags.join('|');

  async function saveNotes() {
    setSavingNotes(true);
    const result = await updateCustomerNotes(customer.id, { notes, tags });
    setSavingNotes(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Saved');
    router.refresh();
  }

  async function toggleConsent(next: boolean) {
    const result = await setMarketingConsent(customer.id, next);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(next ? 'Recorded that they agreed' : 'Recorded that they opted out');
    router.refresh();
  }

  async function confirmMerge() {
    if (!merging) return;
    setMergePending(true);
    const result = await mergeCustomers(merging.id, customer.id);
    setMergePending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`${merging.name} merged into this record`);
    setMerging(null);
    router.refresh();
  }

  function addTag() {
    const value = tagInput.trim();
    if (!value || tags.includes(value)) {
      setTagInput('');
      return;
    }
    setTags((current) => [...current, value]);
    setTagInput('');
  }

  const m = customer.metrics;

  return (
    <>
      <PageHeader
        title={customer.name}
        description={
          m.lastOrderAt
            ? `Customer since ${formatDate(customer.createdAt)} · last order ${formatRelativeTime(m.lastOrderAt, now)}`
            : `Added ${formatDate(customer.createdAt)} · no orders yet`
        }
        actions={
          <Link
            href="/sales/customers"
            className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            All customers
          </Link>
        }
      />

      <PageBody className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* ── What they're worth ──────────────────────────────────── */}
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
            <Metric label="Orders" value={m.orderCount > 0 ? formatNumber(m.orderCount) : '—'} />
            <Metric label="Total spent" value={m.orderCount > 0 ? money(m.totalSpend) : '—'} />
            <Metric label="Average order" value={m.orderCount > 0 ? money(m.averageOrder) : '—'} />
            <Metric
              label="Returns"
              value={
                m.returnRatio === null
                  ? '—'
                  : `${formatNumber(m.returnCount)} (${Math.round(m.returnRatio * 100)}%)`
              }
            />
          </section>

          {m.outstandingInvoices > 0 && (
            <Link
              href={`/sales/invoices`}
              className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:hover:bg-amber-950/60"
            >
              <Receipt className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <span className="font-medium text-foreground">
                {money(m.outstandingAmount)} outstanding across{' '}
                {m.outstandingInvoices === 1 ? '1 invoice' : `${m.outstandingInvoices} invoices`}
              </span>
            </Link>
          )}

          {/* ── What they buy ───────────────────────────────────────── */}
          {customer.topProducts.length > 0 && (
            <section className="rounded-lg border bg-card">
              <h2 className="border-b px-4 py-3 text-sm font-semibold">What they buy most</h2>
              <ul className="divide-y text-sm">
                {customer.topProducts.map((product) => (
                  <li key={product.productId ?? product.name} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate">{product.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatNumber(product.quantity)} bought
                    </span>
                    <span className="w-24 shrink-0 text-right font-medium tabular-nums">{money(product.spend)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Their orders ────────────────────────────────────────── */}
          <section className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Orders</h2>
            {customer.orders.length === 0 ? (
              <EmptyState
                icon={ShoppingBag}
                title="No orders yet"
                description="When they buy something — online or at the counter — it appears here."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableColumnHeader>Order</TableColumnHeader>
                      <TableColumnHeader>Placed</TableColumnHeader>
                      <TableColumnHeader>Status</TableColumnHeader>
                      <TableColumnHeader align="right">Items</TableColumnHeader>
                      <TableColumnHeader align="right">Total</TableColumnHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {customer.orders.map((order) => (
                      <TableRow
                        key={order.id}
                        clickable
                        onClick={() => router.push(`/sales/orders/${order.id}`)}
                      >
                        <TableCell>
                          <span className="flex items-center gap-1.5">
                            <Link
                              href={`/sales/orders/${order.id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="font-medium tabular-nums text-foreground hover:underline"
                            >
                              {order.reference}
                            </Link>
                            <Badge variant={ORDER_CHANNEL_VARIANT[order.channel] ?? 'draft'}>
                              {ORDER_CHANNEL_LABEL[order.channel] ?? order.channel}
                            </Badge>
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(order.placedAt)}</TableCell>
                        <TableCell>
                          <Badge variant={ORDER_STATUS_VARIANT[order.status] ?? 'draft'}>
                            {ORDER_STATUS_LABEL[order.status] ?? order.status}
                          </Badge>
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatNumber(order.itemCount)}
                        </TableCell>
                        <TableCell align="right" className="font-medium tabular-nums">
                          {formatMoney(order.totalAmount, order.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </section>

          {/* ── What they said ──────────────────────────────────────── */}
          {(customer.reviews.length > 0 || customer.questions.length > 0) && (
            <section className="rounded-lg border bg-card">
              <h2 className="border-b px-4 py-3 text-sm font-semibold">What they’ve said</h2>
              <ul className="divide-y text-sm">
                {customer.reviews.map((review) => (
                  <li key={review.id} className="flex items-start gap-3 px-4 py-3">
                    <Star className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {review.rating}/5 on {review.productName}
                      </p>
                      {review.title && <p className="text-muted-foreground">“{review.title}”</p>}
                      <p className="text-xs text-muted-foreground">
                        {formatDate(review.createdAt)} · {enumLabel(review.status)}
                      </p>
                    </div>
                  </li>
                ))}
                {customer.questions.map((question) => (
                  <li key={question.id} className="flex items-start gap-3 px-4 py-3">
                    <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground">“{question.body}”</p>
                      <p className="text-xs text-muted-foreground">
                        On {question.productName} · {formatDate(question.createdAt)} ·{' '}
                        {enumLabel(question.status)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ── Who they are, and what to remember ────────────────────── */}
        <aside className="space-y-4">
          <section className="space-y-3 rounded-lg border bg-card p-4 text-sm">
            <h2 className="text-sm font-semibold">Contact</h2>
            <Line icon={Mail} value={customer.email} href={customer.email ? `mailto:${customer.email}` : null} />
            <Line icon={Phone} value={customer.phone} href={customer.phone ? `tel:${customer.phone}` : null} />
            {customer.address && <Line icon={MapPin} value={customer.address} href={null} />}
            {customer.addresses.map((address) => (
              <Line
                key={address.id}
                icon={MapPin}
                value={`${address.line1}${address.line2 ? `, ${address.line2}` : ''}, ${address.city}, ${address.state}`}
                href={null}
                note={address.isDefault ? 'Default delivery address' : undefined}
              />
            ))}
            <p className="border-t pt-2 text-xs text-muted-foreground">
              {customer.hasAccount
                ? `Has an online account${customer.lastLoginAt ? ` · last signed in ${formatRelativeTime(customer.lastLoginAt, now)}` : ''}`
                : 'No online account — added by your team'}
            </p>
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Marketing</h2>
            <label className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium">Happy to hear from you</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {customer.consentUpdatedAt
                    ? `Last changed ${formatDate(customer.consentUpdatedAt)}`
                    : 'Not recorded yet'}
                </span>
              </span>
              <SwitchRoot
                checked={customer.marketingConsent}
                disabled={!canManage}
                onCheckedChange={toggleConsent}
                aria-label="Agreed to marketing"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Only tick this if they told you so. Campaigns will only ever go to customers who did.
            </p>
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Labels and notes</h2>
            <FieldDescription>Only your team sees these.</FieldDescription>

            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge key={tag} variant="muted" className="gap-1">
                  {tag}
                  {canManage && (
                    <button
                      type="button"
                      aria-label={`Remove label ${tag}`}
                      onClick={() => setTags((current) => current.filter((t) => t !== tag))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      ×
                    </button>
                  )}
                </Badge>
              ))}
              {tags.length === 0 && <span className="text-xs text-muted-foreground">No labels yet</span>}
            </div>

            {canManage && (
              <>
                <Field>
                  <Label htmlFor="customer-tag" className="sr-only">
                    Add a label
                  </Label>
                  <Input
                    id="customer-tag"
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="Add a label and press Enter"
                  />
                </Field>

                <Field>
                  <Label htmlFor="customer-notes" className="sr-only">
                    Notes
                  </Label>
                  <Textarea
                    id="customer-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={4}
                    placeholder="Anything worth remembering — how they like to be contacted, what they usually order"
                  />
                </Field>

                <Button size="sm" onClick={saveNotes} disabled={savingNotes || !notesDirty} className="w-full">
                  {savingNotes && <Loader2 className="size-3.5 animate-spin" />}
                  {notesDirty ? 'Save notes' : 'Saved'}
                </Button>
              </>
            )}

            {!canManage && customer.notes && (
              <p className="whitespace-pre-line text-sm text-muted-foreground">{customer.notes}</p>
            )}
          </section>

          {/* ── The same person, met twice ──────────────────────────── */}
          {canManage && duplicates.length > 0 && (
            <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Users className="size-4" aria-hidden />
                Possibly the same person
              </h2>
              <p className="text-xs text-muted-foreground">
                Merging moves their orders, invoices and reviews onto this record. It can’t be undone.
              </p>
              <ul className="space-y-2">
                {duplicates.map((candidate) => (
                  <li key={candidate.id} className="rounded-md border bg-card px-3 py-2 text-sm">
                    <p className="font-medium">{candidate.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[candidate.phone, candidate.email].filter(Boolean).join(' · ') || 'No contact details'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {MERGE_REASON[candidate.reason]} ·{' '}
                      {candidate.orderCount === 1 ? '1 order' : `${formatNumber(candidate.orderCount)} orders`}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button size="xs" variant="outline" asChild>
                        <Link href={`/sales/customers/${candidate.id}`}>Open</Link>
                      </Button>
                      <Button size="xs" onClick={() => setMerging(candidate)}>
                        Merge into this
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {customer.mergedFrom.length > 0 && (
            <p className="rounded-lg border bg-card p-4 text-xs text-muted-foreground">
              Includes the history of{' '}
              {customer.mergedFrom.map((m) => m.name).join(', ')}, merged in
              {customer.mergedFrom[0]?.mergedAt ? ` ${formatDate(customer.mergedFrom[0].mergedAt)}` : ''}.
            </p>
          )}
        </aside>
      </PageBody>

      <AlertDialogRoot open={merging !== null} onOpenChange={(next) => !next && setMerging(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge {merging?.name} into {customer.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every order, invoice, quote, review and address belonging to {merging?.name} moves to{' '}
              {customer.name}, and their figures are counted together from then on. The old record stays
              behind pointing here, but stops appearing in your customer list. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep both</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmMerge} disabled={mergePending}>
              {mergePending && <Loader2 className="size-3.5 animate-spin" />}
              Merge customers
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function Line({
  icon: Icon,
  value,
  href,
  note,
}: {
  icon: React.ElementType;
  value: string | null;
  href: string | null;
  note?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        {href && value ? (
          <a href={href} className="break-all text-foreground hover:underline">
            {value}
          </a>
        ) : (
          <span className="break-words text-foreground">{value ?? '—'}</span>
        )}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </div>
    </div>
  );
}
