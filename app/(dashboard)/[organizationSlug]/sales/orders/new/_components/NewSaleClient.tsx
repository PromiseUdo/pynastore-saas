'use client';

/*
 * The till.
 *
 * Search, tap, done. The search box keeps focus and clears itself after each
 * pick, so a barcode scanner — which types a code and presses Enter — works
 * without anyone touching the mouse.
 *
 * Prices shown here are the catalogue's. Staff can change a line's price
 * (haggling is normal in a shop), and the server records the difference as a
 * discount rather than pretending the catalogue said something else.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Minus, Plus, ShoppingCart, Trash2, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Field, FieldDescription } from '@/components/ui/form-field';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SearchPicker } from '@/components/sales/search-picker';
import { formatMoney, formatNumber } from '@/lib/format';
import { COUNTER_PAYMENT_LABEL } from '@/lib/sales/order-labels';
import {
  recordCounterSale,
  searchCustomers,
  searchSellableProducts,
  type CounterCustomer,
  type CounterStore,
  type SellableProduct,
} from '@/features/sales/counter-sale';

type Line = {
  inventoryItemId: string;
  name: string;
  variantName: string | null;
  sku: string;
  /** what the catalogue says, kept so an override can be seen for what it is */
  cataloguePrice: number;
  unitPrice: number;
  quantity: number;
  available: number;
};

const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'later'] as const;

export function NewSaleClient({ stores, currency }: { stores: CounterStore[]; currency: string }) {
  const router = useRouter();

  const [warehouseId, setWarehouseId] = React.useState(stores[0]?.id ?? '');
  const [channel, setChannel] = React.useState<'WALK_IN' | 'PHONE'>('WALK_IN');
  const [lines, setLines] = React.useState<Line[]>([]);

  /* Either an existing customer was picked, or a name is being typed for a
   * new one. Never both: picking someone replaces the typed details, and
   * clearing them hands the fields back. */
  const [customer, setCustomer] = React.useState<CounterCustomer | null>(null);
  const [customerName, setCustomerName] = React.useState('');
  const [customerPhone, setCustomerPhone] = React.useState('');
  const [paymentMethod, setPaymentMethod] = React.useState<(typeof PAYMENT_METHODS)[number]>('cash');
  const [discount, setDiscount] = React.useState('');
  const [note, setNote] = React.useState('');
  const [pending, setPending] = React.useState(false);

  /* Bound to the chosen store: what matters at the counter is what is on
   * the shelf HERE. */
  const findProducts = React.useCallback(
    (query: string) => searchSellableProducts(warehouseId, query),
    [warehouseId],
  );

  function pickCustomer(picked: CounterCustomer) {
    setCustomer(picked);
    setCustomerName(picked.name);
    setCustomerPhone(picked.phone ?? '');
  }

  function clearCustomer() {
    setCustomer(null);
    setCustomerName('');
    setCustomerPhone('');
  }

  function addLine(product: SellableProduct) {
    setLines((current) => {
      const existing = current.find((l) => l.inventoryItemId === product.inventoryItemId);
      if (existing) {
        return current.map((l) =>
          l.inventoryItemId === product.inventoryItemId ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...current,
        {
          inventoryItemId: product.inventoryItemId,
          name: product.name,
          variantName: product.variantName,
          sku: product.sku,
          cataloguePrice: product.unitPrice,
          unitPrice: product.unitPrice,
          quantity: 1,
          available: product.available,
        },
      ];
    });
  }

  function setQuantity(id: string, quantity: number) {
    if (quantity < 1) return;
    setLines((current) => current.map((l) => (l.inventoryItemId === id ? { ...l, quantity } : l)));
  }

  function setPrice(id: string, unitPrice: number) {
    setLines((current) => current.map((l) => (l.inventoryItemId === id ? { ...l, unitPrice } : l)));
  }

  function removeLine(id: string) {
    setLines((current) => current.filter((l) => l.inventoryItemId !== id));
  }

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const discountValue = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = subtotal - discountValue;

  /* A line asking for more than the shelf holds is stopped here as well as on
   * the server, so nobody fills a basket only to be refused at the end. */
  const overstocked = lines.filter((l) => l.quantity > l.available);

  async function submit() {
    if (lines.length === 0 || pending) return;
    if (overstocked.length > 0) {
      toast.error('Some lines ask for more than the store has');
      return;
    }

    setPending(true);
    const result = await recordCounterSale({
      channel,
      warehouseId,
      customerId: customer?.id ?? null,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      paymentMethod,
      discount: discountValue,
      note: note.trim() || undefined,
      lines: lines.map((l) => ({
        inventoryItemId: l.inventoryItemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    });

    if (!result.success) {
      setPending(false);
      toast.error(result.error);
      return;
    }

    /* Deliberately NOT clearing `pending` on success: the sale is already in
     * the database and the stock has already left, so the button must stay
     * disabled until this page is gone. Re-enabling it for the moment the
     * navigation takes would let a second click ring the whole thing up
     * twice.
     *
     * `replace`, not `push`: Back from a finished sale should reach the order
     * list, not a till still holding goods that have been sold. And no
     * `router.refresh()` — it re-renders the page being navigated away from,
     * which leaves the navigation hanging with nothing to show for it.
     */
    toast.success(`Sale ${result.data.reference} recorded`);
    router.replace(`/sales/orders/${result.data.orderId}`);
  }

  return (
    <>
      <PageHeader
        title="New sale"
        description="Ring up someone at the counter, or an order taken over the phone."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/sales/orders">
              <ArrowLeft className="size-3.5" />
              Back to orders
            </Link>
          </Button>
        }
      />

      <PageBody className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* ── Picking the goods ─────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Field className="min-w-48 flex-1">
              <Label htmlFor="store">Selling from</Label>
              <SelectRoot
                value={warehouseId}
                onValueChange={(value) => {
                  setWarehouseId(value);
                  // Stock is per store, so what's in the basket no longer applies.
                  setLines([]);
                }}
              >
                <SelectTrigger id="store">
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
              <FieldDescription>The stock comes out of this store.</FieldDescription>
            </Field>

            <Field className="min-w-40">
              <Label htmlFor="channel">Sale type</Label>
              <SelectRoot value={channel} onValueChange={(v) => setChannel(v as 'WALK_IN' | 'PHONE')}>
                <SelectTrigger id="channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WALK_IN">In store</SelectItem>
                  <SelectItem value="PHONE">Over the phone</SelectItem>
                </SelectContent>
              </SelectRoot>
            </Field>
          </div>

          <Field>
            <Label htmlFor="product-search">Add items</Label>
            <SearchPicker<SellableProduct>
              id="product-search"
              label="Search products"
              placeholder="Scan a barcode, or search by name or SKU"
              autoFocus
              onSearch={findProducts}
              onPick={addLine}
              getKey={(p) => p.inventoryItemId}
              isDisabled={(p) => p.available <= 0}
              emptyHint="Nothing matches in this store."
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
                    {p.available > 0 ? `${formatNumber(p.available)} in stock` : 'Out of stock'}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{formatMoney(p.unitPrice, currency)}</span>
                </>
              )}
            />
            <FieldDescription>Scanning adds it straight away. ↑ ↓ to choose, Enter to add.</FieldDescription>
          </Field>

          {/* ── The basket ──────────────────────────────────────────── */}
          <div className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">
              Items {lines.length > 0 && <span className="text-muted-foreground">({lines.length})</span>}
            </h2>

            {lines.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                <ShoppingCart className="size-4" aria-hidden />
                Nothing added yet. Search above to start.
              </p>
            ) : (
              <ul className="divide-y">
                {lines.map((line) => {
                  const tooMany = line.quantity > line.available;
                  return (
                    <li key={line.inventoryItemId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="min-w-40 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {line.name}
                          {line.variantName ? ` · ${line.variantName}` : ''}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {line.sku} · {formatNumber(line.available)} in stock
                          {line.unitPrice !== line.cataloguePrice && (
                            <Badge variant="info" className="ml-1.5">
                              Price changed
                            </Badge>
                          )}
                        </span>
                        {tooMany && (
                          <span className="block text-xs font-medium text-destructive" role="alert">
                            Only {formatNumber(line.available)} in this store
                          </span>
                        )}
                      </span>

                      <span className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`One fewer ${line.name}`}
                          onClick={() => setQuantity(line.inventoryItemId, line.quantity - 1)}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <Input
                          value={line.quantity}
                          onChange={(e) => setQuantity(line.inventoryItemId, Number(e.target.value) || 1)}
                          inputMode="numeric"
                          aria-label={`Quantity of ${line.name}`}
                          className="h-8 w-14 text-center tabular-nums"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`One more ${line.name}`}
                          onClick={() => setQuantity(line.inventoryItemId, line.quantity + 1)}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </span>

                      <Input
                        value={line.unitPrice}
                        onChange={(e) => setPrice(line.inventoryItemId, Math.max(0, Number(e.target.value) || 0))}
                        inputMode="decimal"
                        aria-label={`Price of ${line.name}`}
                        className="h-8 w-24 text-right tabular-nums"
                      />

                      <span className="w-24 text-right text-sm font-medium tabular-nums">
                        {formatMoney(line.unitPrice * line.quantity, currency)}
                      </span>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${line.name}`}
                        onClick={() => removeLine(line.inventoryItemId)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ── Taking the money ──────────────────────────────────────── */}
        <aside className="space-y-4">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Payment</h2>

            <Field>
              <Label htmlFor="payment">How they paid</Label>
              <SelectRoot
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod(v as (typeof PAYMENT_METHODS)[number])}
              >
                <SelectTrigger id="payment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {COUNTER_PAYMENT_LABEL[method]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
              {paymentMethod === 'later' && (
                <FieldDescription>
                  The sale is recorded as unpaid. The goods still leave your stock.
                </FieldDescription>
              )}
            </Field>

            <Field>
              <Label htmlFor="discount">Discount</Label>
              <Input
                id="discount"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="text-right tabular-nums"
              />
              <FieldDescription>Taken off the whole sale.</FieldDescription>
            </Field>

            <dl className="space-y-1.5 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(subtotal, currency)}</dd>
              </div>
              {discountValue > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Discount</dt>
                  <dd className="tabular-nums">−{formatMoney(discountValue, currency)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(total, currency)}</dd>
              </div>
            </dl>

            <Button
              type="button"
              className="w-full"
              onClick={submit}
              disabled={pending || lines.length === 0 || overstocked.length > 0}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {paymentMethod === 'later'
                ? `Record sale · ${formatMoney(total, currency)}`
                : `Take payment · ${formatMoney(total, currency)}`}
            </Button>
          </div>

          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Customer</h2>
            <FieldDescription>
              Optional — a cash sale doesn’t need one. Type a name to start a new record, or
              search for someone who has bought before.
            </FieldDescription>

            {customer ? (
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-foreground">{customer.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[customer.phone, customer.email].filter(Boolean).join(' · ') || 'No contact details'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {customer.orderCount === 1 ? '1 previous order' : `${formatNumber(customer.orderCount)} previous orders`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove this customer from the sale"
                  onClick={clearCustomer}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <Field>
                  <Label htmlFor="customer-search">Find an existing customer</Label>
                  <SearchPicker<CounterCustomer>
                    id="customer-search"
                    label="Search customers"
                    placeholder="Search name, phone or email"
                    minLength={2}
                    onSearch={searchCustomers}
                    onPick={pickCustomer}
                    getKey={(c) => c.id}
                    emptyHint="Nobody matches. Type their name below to start a new record."
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
                </Field>

                <Field>
                  <Label htmlFor="customer-name">Or a new customer’s name</Label>
                  <Input
                    id="customer-name"
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder="e.g. Ada Obi"
                  />
                  <FieldDescription>We’ll save them, so their next visit is already here.</FieldDescription>
                </Field>

                <Field>
                  <Label htmlFor="customer-phone">Phone</Label>
                  <Input
                    id="customer-phone"
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    placeholder="0801 234 5678"
                  />
                </Field>
              </>
            )}

            <Field>
              <Label htmlFor="note">Note</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                placeholder="Anything worth remembering about this sale"
              />
            </Field>
          </div>
        </aside>
      </PageBody>
    </>
  );
}
