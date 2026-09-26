'use client';

/*
 * Writing an invoice.
 *
 * The two things the old dialog got wrong, and what replaced them:
 *
 *  1. "Create draft" told you the STATUS, not what the button did — and an
 *     invoice is a real, numbered record from that click, not a saved form.
 *     There are now two buttons that each name their own result: "Create and
 *     send" (what a merchant almost always means) and "Save as draft" (write
 *     it now, send it later). The line under them says what each will do.
 *
 *  2. Line items were a `<Select>` of the entire catalogue. They are now a
 *     search, because a select can't be searched.
 *
 * Totals are shown as they are typed — nobody should have to save a document
 * to find out what it comes to.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Package, Send, Trash2, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SearchPicker } from '@/components/ui/search-picker';
import { formatMoney, formatNumber } from '@/lib/format';
import { searchSalesCustomers, searchSalesProducts, type CustomerMatch, type ProductMatch } from '@/features/sales/lookup';
import { createInvoice, sendInvoice } from '@/features/sales/actions';

type Line = {
  key: string;
  inventoryItemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  available: number;
  preferredSupplierId: string | null;
  isDropShip: boolean;
};

export function NewInvoiceForm({
  stores,
  currency,
}: {
  stores: { id: string; name: string }[];
  currency: string;
}) {
  const router = useRouter();

  const [customer, setCustomer] = React.useState<CustomerMatch | null>(null);
  const [warehouseId, setWarehouseId] = React.useState(stores[0]?.id ?? '');
  const [dueDate, setDueDate] = React.useState('');
  const [taxAmount, setTaxAmount] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([]);

  const [pending, setPending] = React.useState<'draft' | 'send' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);

  const money = (value: number) => formatMoney(value, currency);

  /* Bound to the chosen store, so "in stock" means the shelf this invoice
   * will actually be fulfilled from. */
  const findProducts = React.useCallback(
    (query: string) => searchSalesProducts(warehouseId, query),
    [warehouseId],
  );

  function addLine(product: ProductMatch) {
    setLines((current) => {
      const existing = current.find((l) => l.inventoryItemId === product.id);
      if (existing) {
        return current.map((l) =>
          l.inventoryItemId === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...current,
        {
          key: product.id,
          inventoryItemId: product.id,
          description: product.variantName ? `${product.name} (${product.variantName})` : product.name,
          quantity: 1,
          unitPrice: product.unitPrice,
          available: product.available,
          preferredSupplierId: product.preferredSupplierId,
          isDropShip: false,
        },
      ];
    });
  }

  /* Not everything billable is a product: delivery, fitting, a callout fee. */
  function addFreeTextLine() {
    setLines((current) => [
      ...current,
      {
        key: `custom-${Date.now()}`,
        inventoryItemId: null,
        description: '',
        quantity: 1,
        unitPrice: 0,
        available: 0,
        preferredSupplierId: null,
        isDropShip: false,
      },
    ]);
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((l) => l.key !== key));
  }

  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const tax = Math.max(0, Number(taxAmount) || 0);
  const total = subtotal + tax;

  /* Named problems, checked as you go — not a single message at the bottom
   * after you press the button. */
  const problems = {
    customer: !customer ? 'Choose who this invoice is for' : null,
    lines: lines.length === 0 ? 'Add at least one line' : null,
    descriptions: lines.some((l) => !l.description.trim()) ? 'Every line needs a description' : null,
    quantities: lines.some((l) => l.quantity <= 0) ? 'Every line needs a quantity of at least 1' : null,
  };
  const firstProblem = Object.values(problems).find(Boolean) ?? null;

  /* Short of stock doesn't stop an invoice being written — a merchant may be
   * billing for something on order — but it is worth saying out loud, since
   * issuing it is what will fail. */
  const short = lines.filter((l) => l.inventoryItemId && !l.isDropShip && l.quantity > l.available);

  async function submit(mode: 'draft' | 'send') {
    setTouched(true);
    if (firstProblem) {
      setError(firstProblem);
      return;
    }

    setPending(mode);
    setError(null);

    const created = await createInvoice({
      customerId: customer!.id,
      warehouseId,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      taxAmount: tax || undefined,
      notes: notes.trim() || undefined,
      lineItems: lines.map((l) => ({
        inventoryItemId: l.inventoryItemId ?? undefined,
        description: l.description.trim(),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        isDropShip: l.isDropShip,
      })),
    });

    if (!created.success) {
      setPending(null);
      setError(created.error);
      return;
    }

    if (mode === 'draft') {
      toast.success('Invoice saved as a draft');
      router.replace(`/sales/invoices/${created.data.id}`);
      return;
    }

    /* The invoice exists either way. If sending fails — no email on the
     * customer, stock short at the store — say so on its own page rather
     * than losing the work that was just typed. */
    const delivered = await sendInvoice(created.data.id);
    if (!delivered.success) {
      toast.error(`Invoice created, but not sent: ${delivered.error}`);
    } else {
      toast.success(`Invoice sent to ${customer!.name}`);
    }
    router.replace(`/sales/invoices/${created.data.id}`);
  }

  const busy = pending !== null;

  return (
    <>
      <PageHeader
        title="New invoice"
        description="Bill a customer directly, without going through a quote."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/sales/invoices">
              <ArrowLeft className="size-3.5" />
              Back to invoices
            </Link>
          </Button>
        }
      />

      <PageBody className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* ── Who and where ───────────────────────────────────────── */}
          <section className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Who it’s for</h2>

            {customer ? (
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-foreground">{customer.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[customer.phone, customer.email].filter(Boolean).join(' · ') || 'No contact details'}
                  </p>
                  {!customer.email && (
                    /* Said now, not after they press "Create and send". */
                    <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">
                      No email address, so this invoice can’t be sent to them yet.
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Choose a different customer"
                  onClick={() => setCustomer(null)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <Field>
                <Label htmlFor="invoice-customer">
                  Customer <span className="text-destructive">*</span>
                </Label>
                <SearchPicker<CustomerMatch>
                  id="invoice-customer"
                  label="Search customers"
                  placeholder="Search by name, phone or email"
                  minLength={2}
                  onSearch={searchSalesCustomers}
                  onPick={setCustomer}
                  getKey={(c) => c.id}
                  emptyHint="Nobody matches. Add them under Sales → Customers first."
                  renderItem={(c) => (
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'}
                        {c.orderCount > 0 && ` · ${formatNumber(c.orderCount)} orders`}
                      </span>
                    </span>
                  )}
                />
                {touched && problems.customer && <FieldError>{problems.customer}</FieldError>}
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="invoice-store">
                  Fulfilled from <span className="text-destructive">*</span>
                </Label>
                <SelectRoot
                  value={warehouseId}
                  onValueChange={(value) => {
                    setWarehouseId(value);
                    /* Stock is per store, so what was picked no longer
                     * describes what's on the shelf. */
                    setLines([]);
                  }}
                >
                  <SelectTrigger id="invoice-store">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
                <FieldDescription>Stock is committed here when the invoice is issued.</FieldDescription>
              </Field>

              <Field>
                <Label htmlFor="invoice-due">Due date</Label>
                <Input
                  id="invoice-due"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
                <FieldDescription>Leave it empty if there’s no deadline.</FieldDescription>
              </Field>
            </div>
          </section>

          {/* ── What's on it ────────────────────────────────────────── */}
          <section className="space-y-4 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">What it’s for</h2>
              <Button type="button" variant="outline" size="sm" onClick={addFreeTextLine}>
                Add a line by hand
              </Button>
            </div>

            <Field>
              <Label htmlFor="invoice-item">Add a product</Label>
              <SearchPicker<ProductMatch>
                id="invoice-item"
                label="Search products"
                placeholder="Search by name, SKU or barcode"
                onSearch={findProducts}
                onPick={addLine}
                getKey={(p) => p.id}
                renderItem={(p) => (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">
                        {p.name}
                        {p.variantName ? ` · ${p.variantName}` : ''}
                      </span>
                      <span className="block text-xs text-muted-foreground">{p.sku}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {p.available > 0 ? `${formatNumber(p.available)} in stock` : 'None in stock'}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{money(p.unitPrice)}</span>
                  </>
                )}
              />
              <FieldDescription>
                Anything that isn’t a product — delivery, labour, a callout fee — goes in by hand.
              </FieldDescription>
            </Field>

            {lines.length === 0 ? (
              <p className="flex items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
                <Package className="size-4" aria-hidden />
                Nothing on this invoice yet.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {lines.map((line) => {
                  const isShort = Boolean(line.inventoryItemId) && !line.isDropShip && line.quantity > line.available;
                  return (
                    <li key={line.key} className="space-y-2 px-3 py-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-40 flex-1">
                          <Input
                            value={line.description}
                            onChange={(event) => updateLine(line.key, { description: event.target.value })}
                            placeholder="What are you billing for?"
                            aria-label="Line description"
                            aria-invalid={touched && !line.description.trim()}
                          />
                          {line.inventoryItemId && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatNumber(line.available)} in stock at this store
                              {isShort && (
                                <span className="ml-1.5 font-medium text-amber-700 dark:text-amber-500">
                                  · short by {formatNumber(line.quantity - line.available)}
                                </span>
                              )}
                            </p>
                          )}
                        </div>

                        <Input
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(line.key, { quantity: Math.max(0, Number(event.target.value) || 0) })
                          }
                          inputMode="numeric"
                          aria-label="Quantity"
                          className="h-8 w-16 text-center tabular-nums"
                        />
                        <Input
                          value={line.unitPrice}
                          onChange={(event) =>
                            updateLine(line.key, { unitPrice: Math.max(0, Number(event.target.value) || 0) })
                          }
                          inputMode="decimal"
                          aria-label="Unit price"
                          className="h-8 w-24 text-right tabular-nums"
                        />
                        <span className="w-24 pt-1.5 text-right text-sm font-medium tabular-nums">
                          {money(line.quantity * line.unitPrice)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${line.description || 'this line'}`}
                          onClick={() => removeLine(line.key)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>

                      {line.inventoryItemId && (
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CheckboxRoot
                            checked={line.isDropShip}
                            disabled={!line.preferredSupplierId}
                            onCheckedChange={(value) => updateLine(line.key, { isDropShip: value === true })}
                          />
                          {line.preferredSupplierId
                            ? 'Drop-ship this line straight from the supplier'
                            : 'Drop-ship needs a preferred supplier on this product'}
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {touched && (problems.lines || problems.descriptions || problems.quantities) && (
              <FieldError>{problems.lines ?? problems.descriptions ?? problems.quantities}</FieldError>
            )}
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Notes</h2>
            <Field>
              <Label htmlFor="invoice-notes">Shown on the invoice</Label>
              <Textarea
                id="invoice-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="Payment terms, a reference, a thank-you"
              />
            </Field>
          </section>
        </div>

        {/* ── What it comes to, and what happens next ───────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Total</h2>

            <Field>
              <Label htmlFor="invoice-tax">Tax</Label>
              <Input
                id="invoice-tax"
                value={taxAmount}
                onChange={(event) => setTaxAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="text-right tabular-nums"
              />
            </Field>

            <dl className="space-y-1.5 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{money(subtotal)}</dd>
              </div>
              {tax > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Tax</dt>
                  <dd className="tabular-nums">{money(tax)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(total)}</dd>
              </div>
            </dl>

            {short.length > 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
                {short.length === 1 ? 'One line is' : `${short.length} lines are`} short of stock at this store.
                You can still write the invoice, but issuing it will fail until the stock is there or the
                line is drop-shipped.
              </p>
            )}

            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <div className="space-y-2">
              <Button
                type="button"
                className="w-full"
                onClick={() => submit('send')}
                disabled={busy || (customer !== null && !customer.email)}
              >
                {pending === 'send' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Create and send
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => submit('draft')}
                disabled={busy}
              >
                {pending === 'draft' && <Loader2 className="size-4 animate-spin" />}
                Save as draft
              </Button>
            </div>

            {/* What each button actually does, in the order it happens. */}
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Create and send</span> saves the invoice, commits
              the stock at {stores.find((s) => s.id === warehouseId)?.name ?? 'the store'}, and emails it to
              your customer.{' '}
              <span className="font-medium text-foreground">Save as draft</span> only saves it — no stock is
              committed and nothing is sent until you send it.
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Status</h2>
            <ol className="mt-3 space-y-2 text-xs text-muted-foreground">
              <Step badge="draft" label="Draft" note="Written down. Nobody has seen it." />
              <Step badge="pending" label="Sent" note="Stock committed, emailed to the customer." />
              <Step badge="completed" label="Paid" note="Once you record the money arriving." />
            </ol>
          </div>
        </aside>
      </PageBody>
    </>
  );
}

function Step({ badge, label, note }: { badge: 'draft' | 'pending' | 'completed'; label: string; note: string }) {
  return (
    <li className="flex items-start gap-2">
      <Badge variant={badge} className="shrink-0">
        {label}
      </Badge>
      <span className="pt-0.5">{note}</span>
    </li>
  );
}
