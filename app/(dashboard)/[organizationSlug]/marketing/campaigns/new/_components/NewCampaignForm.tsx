'use client';

/*
 * Setting up a sale.
 *
 * The whole screen is built around one idea: you see what will change before
 * it changes. Pick what it covers and how much off, and the panel on the
 * right lists every product with its old price beside its new one, and what
 * the sale will cost if everything sells at the same rate. Nothing is
 * committed until "Schedule".
 *
 * Products are searched, not listed in a dropdown — the same picker the till
 * and the invoice form use.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SearchPicker } from '@/components/ui/search-picker';
import { formatMoney, formatNumber } from '@/lib/format';
import { searchCatalogueProducts, type CatalogueProductMatch } from '@/features/sales/lookup';
import { createCampaign, previewCampaignPrices, scheduleCampaign } from '@/features/marketing/campaigns';

type Named = { id: string; name: string };
type TargetKind = 'STORE' | 'PRODUCT' | 'COLLECTION' | 'CATEGORY';

export function NewCampaignForm({
  collections,
  categories,
  currency,
}: {
  collections: Named[];
  categories: Named[];
  currency: string;
}) {
  const router = useRouter();
  const money = (value: number) => formatMoney(value, currency);

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [mechanic, setMechanic] = React.useState<'PERCENT_OFF' | 'FIXED_OFF'>('PERCENT_OFF');
  const [value, setValue] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');
  const [targetKind, setTargetKind] = React.useState<TargetKind>('COLLECTION');
  const [picked, setPicked] = React.useState<Named[]>([]);

  const [preview, setPreview] = React.useState<
    { prices: { inventoryItemId: string; name: string; sku: string; originalPrice: number; price: number }[]; skipped: number } | null
  >(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);

  const numericValue = Number(value) || 0;

  const problems = {
    name: name.trim().length < 2 ? 'Give the campaign a name' : null,
    value:
      numericValue <= 0
        ? 'Enter how much off'
        : mechanic === 'PERCENT_OFF' && numericValue > 100
          ? 'A percentage can’t be more than 100%'
          : null,
    startsAt: !startsAt ? 'Choose when it starts' : null,
    endsAt: endsAt && startsAt && new Date(endsAt) <= new Date(startsAt) ? 'The end has to be after the start' : null,
    targets: targetKind !== 'STORE' && picked.length === 0 ? 'Choose what it applies to' : null,
  };
  const firstProblem = Object.values(problems).find(Boolean) ?? null;

  const input = React.useMemo(
    () => ({
      name: name.trim() || 'Untitled',
      description: description.trim() || undefined,
      mechanic,
      value: numericValue,
      startsAt: startsAt ? new Date(startsAt) : new Date(),
      endsAt: endsAt ? new Date(endsAt) : null,
      targetKind,
      targetIds: targetKind === 'STORE' ? [] : picked.map((p) => p.id),
    }),
    [name, description, mechanic, numericValue, startsAt, endsAt, targetKind, picked],
  );

  /* The preview follows what has been chosen, so the list of prices is never
   * describing a campaign other than the one on screen. */
  const canPreview = numericValue > 0 && (targetKind === 'STORE' || picked.length > 0);
  React.useEffect(() => {
    if (!canPreview) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      const result = await previewCampaignPrices(input);
      if (cancelled) return;
      setPreviewing(false);
      setPreview(result.success ? result.data : null);
      if (!result.success) setError(result.error);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input, canPreview]);

  function togglePick(item: Named) {
    setPicked((current) =>
      current.some((p) => p.id === item.id) ? current.filter((p) => p.id !== item.id) : [...current, item],
    );
  }

  async function submit(andSchedule: boolean) {
    setTouched(true);
    if (firstProblem) {
      setError(firstProblem);
      return;
    }

    setPending(true);
    setError(null);

    const created = await createCampaign({ ...input, name: name.trim() });
    if (!created.success) {
      setPending(false);
      setError(created.error);
      return;
    }

    if (!andSchedule) {
      toast.success('Campaign saved as a draft');
      router.replace(`/marketing/campaigns/${created.data.id}`);
      return;
    }

    const scheduled = await scheduleCampaign(created.data.id);
    if (!scheduled.success) {
      /* The campaign exists either way — say what went wrong on its own page
       * rather than losing what was typed. */
      toast.error(`Campaign saved, but not scheduled: ${scheduled.error}`);
    } else {
      toast.success(`${formatNumber(scheduled.data.priced)} products priced`);
    }
    router.replace(`/marketing/campaigns/${created.data.id}`);
  }

  const totalDiscount =
    preview?.prices.reduce((sum, p) => sum + (p.originalPrice - p.price), 0) ?? 0;

  return (
    <>
      <PageHeader
        title="New campaign"
        description="Put chosen products on sale between two dates."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/marketing/campaigns">
              <ArrowLeft className="size-3.5" />
              Back to campaigns
            </Link>
          </Button>
        }
      />

      <PageBody className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">What it’s called</h2>
            <Field>
              <Label htmlFor="campaign-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="campaign-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Christmas sale"
                aria-invalid={touched && Boolean(problems.name)}
              />
              <FieldDescription>Only your team sees this.</FieldDescription>
              {touched && problems.name && <FieldError>{problems.name}</FieldError>}
            </Field>
            <Field>
              <Label htmlFor="campaign-description">Note</Label>
              <Textarea
                id="campaign-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                placeholder="What this sale is for"
              />
            </Field>
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">How much off</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="campaign-mechanic">Discount</Label>
                <SelectRoot value={mechanic} onValueChange={(v) => setMechanic(v as 'PERCENT_OFF')}>
                  <SelectTrigger id="campaign-mechanic">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENT_OFF">A percentage off</SelectItem>
                    <SelectItem value="FIXED_OFF">An amount off</SelectItem>
                  </SelectContent>
                </SelectRoot>
              </Field>
              <Field>
                <Label htmlFor="campaign-value">
                  {mechanic === 'PERCENT_OFF' ? 'Percent off' : 'Amount off'}{' '}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="campaign-value"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  inputMode="decimal"
                  placeholder={mechanic === 'PERCENT_OFF' ? '20' : '2000'}
                  className="text-right tabular-nums"
                  aria-invalid={touched && Boolean(problems.value)}
                />
                {touched && problems.value && <FieldError>{problems.value}</FieldError>}
              </Field>
            </div>
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">When it runs</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="campaign-start">
                  Starts <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="campaign-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  aria-invalid={touched && Boolean(problems.startsAt)}
                />
                {touched && problems.startsAt && <FieldError>{problems.startsAt}</FieldError>}
              </Field>
              <Field>
                <Label htmlFor="campaign-end">Ends</Label>
                <Input
                  id="campaign-end"
                  type="datetime-local"
                  value={endsAt}
                  min={startsAt || undefined}
                  onChange={(event) => setEndsAt(event.target.value)}
                  aria-invalid={touched && Boolean(problems.endsAt)}
                />
                <FieldDescription>Leave it empty to run until you stop it.</FieldDescription>
                {touched && problems.endsAt && <FieldError>{problems.endsAt}</FieldError>}
              </Field>
            </div>
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">What’s on sale</h2>

            <Field>
              <Label htmlFor="campaign-target">Applies to</Label>
              <SelectRoot
                value={targetKind}
                onValueChange={(v) => {
                  setTargetKind(v as TargetKind);
                  setPicked([]);
                }}
              >
                <SelectTrigger id="campaign-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COLLECTION">Collections</SelectItem>
                  <SelectItem value="CATEGORY">Categories</SelectItem>
                  <SelectItem value="PRODUCT">Chosen products</SelectItem>
                  <SelectItem value="STORE">Everything in the store</SelectItem>
                </SelectContent>
              </SelectRoot>
              {targetKind === 'CATEGORY' && (
                <FieldDescription>
                  Everything filed underneath a category comes with it.
                </FieldDescription>
              )}
            </Field>

            {targetKind === 'PRODUCT' && (
              <Field>
                <Label htmlFor="campaign-product">Add products</Label>
                <SearchPicker<CatalogueProductMatch>
                  id="campaign-product"
                  label="Search products"
                  placeholder="Search by name or SKU"
                  /* Whole products, not variants: a campaign prices the
                   * skirt, not size S. Stock is beside the point here, so no
                   * shelf count is offered to invite the wrong question. */
                  onSearch={searchCatalogueProducts}
                  onPick={(product) => togglePick({ id: product.id, name: product.name })}
                  getKey={(p) => p.id}
                  emptyHint="Nothing matches. Only published products can go on sale."
                  renderItem={(p) => (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.sku}
                          {p.variantCount > 0 &&
                            ` · ${formatNumber(p.variantCount)} ${p.variantCount === 1 ? 'option' : 'options'}`}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {p.priceFrom === p.priceTo
                          ? money(p.priceFrom)
                          : `${money(p.priceFrom)} – ${money(p.priceTo)}`}
                      </span>
                    </>
                  )}
                />
                <FieldDescription>
                  Putting a product on sale covers all of its options. Each one is listed on the right.
                </FieldDescription>
              </Field>
            )}

            {(targetKind === 'COLLECTION' || targetKind === 'CATEGORY') && (
              <div className="flex flex-wrap gap-1.5">
                {(targetKind === 'COLLECTION' ? collections : categories).map((item) => {
                  const on = picked.some((p) => p.id === item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => togglePick(item)}
                      className={
                        on
                          ? 'h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground'
                          : 'h-8 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:text-foreground'
                      }
                    >
                      {item.name}
                    </button>
                  );
                })}
                {(targetKind === 'COLLECTION' ? collections : categories).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    You don’t have any {targetKind === 'COLLECTION' ? 'collections' : 'categories'} yet.
                  </p>
                )}
              </div>
            )}

            {targetKind === 'PRODUCT' && picked.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {picked.map((item) => (
                  <li key={item.id}>
                    <Badge variant="muted" className="gap-1">
                      {item.name}
                      <button
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        onClick={() => togglePick(item)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}

            {touched && problems.targets && <FieldError>{problems.targets}</FieldError>}
          </section>
        </div>

        {/* ── What will actually change ─────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Tag className="size-4" aria-hidden />
              What will change
              {previewing && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            </h2>

            {!canPreview ? (
              <p className="text-sm text-muted-foreground">
                Choose what’s on sale and how much off, and every price that changes will be listed here
                before anything happens.
              </p>
            ) : preview && preview.prices.length === 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
                Nothing this covers would actually change price. Check the products and the discount.
              </p>
            ) : (
              preview && (
                <>
                  <dl className="space-y-1 border-b pb-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Products on sale</dt>
                      <dd className="tabular-nums">{formatNumber(preview.prices.length)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Off, per one of each</dt>
                      <dd className="tabular-nums">{money(totalDiscount)}</dd>
                    </div>
                  </dl>

                  {preview.skipped > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(preview.skipped)}{' '}
                      {preview.skipped === 1 ? 'product is' : 'products are'} left out — the discount
                      wouldn’t change their price.
                    </p>
                  )}

                  <ul className="max-h-96 divide-y overflow-y-auto text-sm">
                    {preview.prices.map((price) => (
                      <li key={price.inventoryItemId} className="flex items-center gap-2 py-2">
                        <span className="min-w-0 flex-1 truncate">{price.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground line-through tabular-nums">
                          {money(price.originalPrice)}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">{money(price.price)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )
            )}

            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <div className="space-y-2 border-t pt-3">
              <Button
                type="button"
                className="w-full"
                onClick={() => submit(true)}
                disabled={pending || !preview || preview.prices.length === 0}
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                Schedule campaign
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => submit(false)}
                disabled={pending}
              >
                Save as draft
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Scheduling</span> fixes these prices and lets
              the campaign run in its window — it starts and stops by itself. Your usual prices are never
              overwritten, so they come back when it ends.
            </p>
          </div>
        </aside>
      </PageBody>
    </>
  );
}
