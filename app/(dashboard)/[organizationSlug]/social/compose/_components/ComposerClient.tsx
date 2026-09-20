'use client';

/*
 * The post composer.
 *
 * Left: what goes in the post. Right: what it will look like. Both read from
 * the same state, so the preview can't drift from what actually publishes —
 * the one thing a preview must never do.
 *
 * Facebook and Instagram are separate destinations, chosen one at a time,
 * because they accept different things: Instagram cannot post without an
 * image and won't make a link clickable; a Facebook Page will do both. Those
 * rules come from the provider (`destination.rules`), not from anything
 * guessed here.
 *
 * Everything AI is a suggestion in an editable box. Nothing on this screen
 * publishes without the merchant pressing Publish.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, ExternalLink, Hash, Loader2, Search, Sparkles, Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { PlatformIcon } from '@/components/social/platform-icon';
import { SocialNav } from '@/components/social/social-nav';
import { PLATFORM_LABELS } from '@/lib/social/types';
import type { ProductListRow } from '@/features/inventory/products';
import {
  generatePostCaption,
  generatePostHashtags,
  getPostProduct,
  publishSocialPost,
  rewritePostCaption,
  searchPostProducts,
  type PostDestination,
  type PostProduct,
} from '@/features/social/posts';

/** Matches REWRITE_TONES in lib/ai/social/copywriter.ts — a fixed list, not free text. */
const REWRITES = [
  { key: 'professional', label: 'More professional' },
  { key: 'playful', label: 'More playful' },
  { key: 'luxurious', label: 'More luxurious' },
  { key: 'concise', label: 'More concise' },
  { key: 'sales', label: 'More sales-focused' },
] as const;

export function ComposerClient({
  destinations,
  composerKey,
  canBrowseCatalogue,
}: {
  destinations: PostDestination[];
  composerKey: string;
  canBrowseCatalogue: boolean;
}) {
  const router = useRouter();

  const usable = destinations.filter((destination) => !destination.problem);
  const [connectionId, setConnectionId] = React.useState(usable[0]?.connectionId ?? '');
  const destination = destinations.find((d) => d.connectionId === connectionId) ?? null;

  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<ProductListRow[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [product, setProduct] = React.useState<PostProduct | null>(null);
  const [imageIds, setImageIds] = React.useState<string[]>([]);

  const [caption, setCaption] = React.useState('');
  const [hashtags, setHashtags] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<null | 'caption' | 'hashtags' | 'rewrite' | 'publish'>(null);

  /* Minted once on the server for this composer. Sent unchanged with every
   * publish attempt, so a double-click lands on the same row. */
  const idempotencyKey = React.useRef(composerKey);

  /* Search as the merchant types, but not on every keystroke. */
  React.useEffect(() => {
    if (!canBrowseCatalogue) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const result = await searchPostProducts(query);
      if (cancelled) return;
      setSearching(false);
      if (result.success) setResults(result.data);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, canBrowseCatalogue]);

  async function chooseProduct(row: ProductListRow) {
    const result = await getPostProduct(row.id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setProduct(result.data);
    // Start with the main image — the one the storefront leads with.
    setImageIds(result.data.images.slice(0, 1).map((image) => image.id));
    setResults([]);
    setQuery('');
  }

  function toggleImage(imageId: string) {
    if (!destination) return;
    setImageIds((current) => {
      if (current.includes(imageId)) return current.filter((id) => id !== imageId);
      if (current.length >= destination.rules.maxImages) {
        // Replacing is friendlier than silently refusing at a limit of one.
        return destination.rules.maxImages === 1 ? [imageId] : current;
      }
      return [...current, imageId];
    });
  }

  async function handleGenerateCaption() {
    if (!product || !destination) return;
    setBusy('caption');
    const result = await generatePostCaption(product.productId, destination.platform);
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setCaption(result.data.text);
    if (result.data.wasEdited) {
      toast.success('Caption written', {
        description: `We removed ${result.data.removed.join(', ')} — we only write what your product record says.`,
      });
    } else {
      toast.success('Caption written');
    }
  }

  async function handleRewrite(tone: string, label: string) {
    if (!product || !destination) return;
    setBusy('rewrite');
    const result = await rewritePostCaption(product.productId, destination.platform, tone, caption);
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setCaption(result.data.text);
    toast.success(`Rewritten: ${label.toLowerCase()}`);
  }

  async function handleHashtags() {
    if (!product || !destination) return;
    setBusy('hashtags');
    const result = await generatePostHashtags(product.productId, destination.platform);
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setHashtags(result.data);
    toast.success(`${result.data.length} hashtags suggested`);
  }

  async function handlePublish() {
    if (!product || !destination) return;
    setBusy('publish');
    const result = await publishSocialPost({
      connectionId: destination.connectionId,
      productId: product.productId,
      imageIds,
      caption,
      hashtags,
      idempotencyKey: idempotencyKey.current,
    });
    setBusy(null);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Published to ${result.data.accountName}`);
    router.push('/social/posts');
    router.refresh();
  }

  /* ─── Nothing to post to yet ──────────────────────────────────────────── */

  if (destinations.length === 0) {
    return (
      <div>
        <PageHeader title="Create post" description="Post one of your products to a connected account." />
        <SocialNav />
        <PageBody>
          <EmptyState
            icon={Sparkles}
            title="Connect an account first"
            description="You need a connected Facebook Page or Instagram account before you can post. It takes a minute."
            action={
              <Button asChild>
                <Link href="/social">Connect an account</Link>
              </Button>
            }
          />
        </PageBody>
      </div>
    );
  }

  const rules = destination?.rules;
  const overLimit = rules ? caption.length > rules.maxCaptionChars : false;
  const needsImage = rules?.imagesRequired && imageIds.length === 0;
  const blocked = !product || !destination || destination.problem !== null || !caption.trim() || overLimit || needsImage;

  const chosenImages = product?.images.filter((image) => imageIds.includes(image.id)) ?? [];

  return (
    <div>
      <PageHeader title="Create post" description="Post one of your products to a connected account." />
      <SocialNav />

      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          {/* ── What goes in the post ─────────────────────────────────── */}
          <div className="space-y-6">
            {/* 1. Destination */}
            <section className="space-y-2">
              <Label>Post to</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {destinations.map((option) => {
                  const selected = option.connectionId === connectionId;
                  const disabled = option.problem !== null;
                  return (
                    <button
                      key={option.connectionId}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setConnectionId(option.connectionId);
                        // A platform change can invalidate the image count.
                        setImageIds((current) => current.slice(0, option.rules.maxImages));
                      }}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                        disabled
                          ? 'cursor-not-allowed opacity-60'
                          : selected
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                      }`}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <PlatformIcon platform={option.platform} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{option.accountName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {PLATFORM_LABELS[option.platform]}
                          {option.username ? ` · @${option.username}` : ''}
                        </span>
                        {option.problem && (
                          <span className="mt-1 block text-xs text-muted-foreground">{option.problem}</span>
                        )}
                      </span>
                      {selected && !disabled && <Check className="size-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 2. Product */}
            <section className="space-y-2">
              <Label htmlFor="product-search">Product</Label>
              {!canBrowseCatalogue ? (
                <p className="text-sm text-muted-foreground">
                  You need access to the catalogue to pick a product. Ask an owner or admin for inventory access.
                </p>
              ) : product ? (
                <div className="flex items-start gap-3 rounded-lg border p-3">
                  {product.images[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.images[0].url}
                      alt=""
                      className="size-12 shrink-0 rounded object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{product.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {product.priceLabel ?? '—'}
                      {product.brandName ? ` · ${product.brandName}` : ''}
                      {product.categoryPath.length ? ` · ${product.categoryPath.join(' › ')}` : ''}
                    </div>
                    {!product.isPublished && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        This product isn’t published on your online store, so the post won’t include a link to it.
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setProduct(null); setImageIds([]); }}>
                    <X className="size-4" />
                    Change
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="product-search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search your products by name or SKU"
                      className="pl-8"
                    />
                    {searching && (
                      <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {results.length > 0 && (
                    <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                      {results.map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            onClick={() => chooseProduct(row)}
                            className="flex w-full items-center gap-3 p-2.5 text-left transition-colors hover:bg-muted/50"
                          >
                            {row.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={row.imageUrl} alt="" className="size-9 shrink-0 rounded object-cover" />
                            ) : (
                              <span className="size-9 shrink-0 rounded bg-muted" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-foreground">{row.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">{row.sku}</span>
                            </span>
                            {!row.isPublished && <Badge variant="muted">Not online</Badge>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>

            {/* 3. Images */}
            {product && rules && (
              <section className="space-y-2">
                <Label>
                  Images{' '}
                  <span className="font-normal text-muted-foreground">
                    {rules.maxImages === 1
                      ? '— one image per post on this platform'
                      : `— up to ${rules.maxImages}`}
                  </span>
                </Label>
                {product.images.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    This product has no images yet.{' '}
                    {rules.imagesRequired
                      ? 'Instagram needs at least one, so add a photo to the product first.'
                      : 'You can still post without one.'}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {product.images.map((image) => {
                      const index = imageIds.indexOf(image.id);
                      const selected = index >= 0;
                      return (
                        <button
                          key={image.id}
                          type="button"
                          onClick={() => toggleImage(image.id)}
                          aria-pressed={selected}
                          aria-label={image.alt ?? 'Product image'}
                          className={`relative size-20 overflow-hidden rounded-lg border-2 transition-colors ${
                            selected ? 'border-primary' : 'border-transparent hover:border-border'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image.url} alt="" className="size-full object-cover" />
                          {selected && (
                            <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground tabular-nums">
                              {rules.maxImages === 1 ? <Check className="size-3" /> : index + 1}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* 4. Caption */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="caption">Caption</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateCaption}
                    disabled={!product || busy !== null}
                  >
                    {busy === 'caption' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    Generate caption
                  </Button>
                  <DropdownMenuRoot>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!product || !caption.trim() || busy !== null}
                      >
                        {busy === 'rewrite' ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                        Rewrite
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {REWRITES.map((option) => (
                        <DropdownMenuItem key={option.key} onSelect={() => handleRewrite(option.key, option.label)}>
                          {option.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenuRoot>
                </div>
              </div>

              <Textarea
                id="caption"
                rows={7}
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Write your caption, or let us draft one from this product."
              />
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {product?.thin
                    ? 'This product has little description, so AI copy will be brief. Adding a description helps.'
                    : 'AI copy is written only from what your product record says. Always read it before posting.'}
                </span>
                {rules && (
                  <span className={overLimit ? 'font-medium text-destructive tabular-nums' : 'text-muted-foreground tabular-nums'}>
                    {caption.length.toLocaleString()} / {rules.maxCaptionChars.toLocaleString()}
                  </span>
                )}
              </div>
            </section>

            {/* 5. Hashtags */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Hashtags</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleHashtags}
                  disabled={!product || busy !== null}
                >
                  {busy === 'hashtags' ? <Loader2 className="size-4 animate-spin" /> : <Hash className="size-4" />}
                  Generate hashtags
                </Button>
              </div>

              {hashtags.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hashtags yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {hashtags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setHashtags((current) => current.filter((item) => item !== tag))}
                      className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted"
                      aria-label={`Remove ${tag}`}
                    >
                      {tag}
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ── Preview ───────────────────────────────────────────────── */}
          <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
            <h2 className="text-sm font-semibold text-foreground">Preview</h2>

            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {destination && <PlatformIcon platform={destination.platform} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {destination?.accountName ?? 'Choose an account'}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {destination ? PLATFORM_LABELS[destination.platform] : '—'}
                  </span>
                </span>
              </div>

              {chosenImages.length > 0 && (
                <div className={chosenImages.length === 1 ? '' : 'grid grid-cols-2 gap-0.5'}>
                  {chosenImages.map((image) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={image.id}
                      src={image.url}
                      alt=""
                      className={chosenImages.length === 1 ? 'aspect-square w-full object-cover' : 'aspect-square w-full object-cover'}
                    />
                  ))}
                </div>
              )}

              <div className="space-y-2 px-3 py-3">
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {caption.trim() || <span className="text-muted-foreground">Your caption appears here.</span>}
                </p>

                {/* Shown exactly where it will actually appear — see composeMessage(). */}
                {product?.productUrl && destination?.rules.supportsLinkInCaption && (
                  <p className="break-all text-sm text-primary">{product.productUrl}</p>
                )}

                {hashtags.length > 0 && (
                  <p className="break-words text-sm text-primary">{hashtags.join(' ')}</p>
                )}
              </div>
            </div>

            {/* The honest caveats, where they matter rather than in a footnote. */}
            {destination && !destination.rules.supportsLinkInCaption && product?.productUrl && (
              <p className="text-xs text-muted-foreground">
                Instagram captions can’t hold a clickable link, so we leave your product link out rather than post a
                dead one. Put it in your bio instead.
              </p>
            )}
            {destination?.rules.maxImages === 1 && (product?.images.length ?? 0) > 1 && (
              <p className="text-xs text-muted-foreground">
                A Facebook Page post here uses one image.
              </p>
            )}

            <div className="space-y-2">
              <Button className="w-full" onClick={handlePublish} disabled={blocked || busy !== null}>
                {busy === 'publish' && <Loader2 className="size-4 animate-spin" />}
                Publish now
              </Button>
              {needsImage && (
                <p className="text-xs text-muted-foreground">Instagram needs at least one image.</p>
              )}
              {product?.productUrl && (
                <a
                  href={product.productUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-3" />
                  View this product on your store
                </a>
              )}
            </div>
          </aside>
        </div>
      </PageBody>
    </div>
  );
}
