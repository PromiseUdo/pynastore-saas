'use client';

/*
 * Telling customers a sale is on.
 *
 * The discount is rarely the whole message — "orders for sale items ship from
 * the 27th" is the sort of thing that needs saying alongside it. So this is a
 * writing box, not a toggle, and what the merchant types is what a shopper
 * reads. Nothing is written for them.
 *
 * The preview is the point of the screen: their words, their colours, at
 * roughly the size a shopper will see, updating as they type. A colour picker
 * without a preview is a way to discover a contrast problem from a customer.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ExternalLink, Loader2, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ANNOUNCEMENT_PRESETS, ANNOUNCEMENT_PREVIEW_PARAM, isHexColour } from '@/lib/marketing/announcement';
import { ImageUploader, type UploadedImage } from '@/components/media/image-uploader';
import { updateCampaignAnnouncement } from '@/features/marketing/campaigns';
import type { CampaignDetail } from '@/features/marketing/campaign-reads';

type Style = 'NONE' | 'BAR' | 'MODAL';

const STYLE_HINT: Record<Style, string> = {
  NONE: 'Customers aren’t told anything. The sale prices still show on your products.',
  BAR: 'A strip across the top of every page. One line — keep it short.',
  MODAL: 'A box that opens once per customer. Room for the details.',
};

export function AnnouncementCard({
  campaign,
  canManage,
  storeName,
  storeUrl,
  destinations,
}: {
  campaign: CampaignDetail;
  canManage: boolean;
  storeName: string;
  /** the shop's own address, for checking the announcement in place */
  storeUrl: string;
  /** real places on this store the link can point at */
  destinations: { label: string; href: string }[];
}) {
  const router = useRouter();
  const a = campaign.announcement;

  const [style, setStyle] = React.useState<Style>((a.style as Style) ?? 'NONE');
  const [text, setText] = React.useState(a.text ?? '');
  const [detail, setDetail] = React.useState(a.detail ?? '');
  const [image, setImage] = React.useState<UploadedImage[]>(
    a.imageUrl && a.imagePublicId ? [{ url: a.imageUrl, publicId: a.imagePublicId }] : [],
  );
  const [uploading, setUploading] = React.useState(false);
  const [cta, setCta] = React.useState(a.cta ?? '');
  const [href, setHref] = React.useState(a.href ?? '');
  const [background, setBackground] = React.useState(a.background ?? '');
  const [foreground, setForeground] = React.useState(a.foreground ?? '');
  const [scroll, setScroll] = React.useState(a.scroll);
  const [saving, setSaving] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  const problems = {
    text: style !== 'NONE' && !text.trim() ? 'Write what you want customers to see' : null,
    /* Only pages this store actually has — the list is built from them, so
     * anything else is a 404 waiting for a customer to find. */
    href: href.trim() && !destinations.some((d) => d.href === href) ? 'Pick where it goes from the list' : null,
    cta: cta.trim() && !href.trim() ? 'A button needs somewhere to go' : null,
    background: background.trim() && !isHexColour(background) ? 'Use a colour like #b42318' : null,
    foreground: foreground.trim() && !isHexColour(foreground) ? 'Use a colour like #ffffff' : null,
  };
  const firstProblem = Object.values(problems).find(Boolean) ?? null;

  async function save() {
    setTouched(true);
    if (firstProblem) {
      toast.error(firstProblem);
      return;
    }
    setSaving(true);
    const result = await updateCampaignAnnouncement(campaign.id, {
      style,
      text,
      detail,
      cta,
      href,
      image: image[0] ? { url: image[0].url, publicId: image[0].publicId } : null,
      background,
      foreground,
      scroll,
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(style === 'NONE' ? 'Announcement turned off' : 'Announcement saved');
    router.refresh();
  }

  const swatch = {
    backgroundColor: isHexColour(background) ? background : undefined,
    color: isHexColour(foreground) ? foreground : undefined,
  };

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Megaphone className="size-4" aria-hidden />
          Tell customers about it
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Your words, on your store, while the campaign is running. It disappears by itself when the
          campaign ends.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field>
            <Label htmlFor="announcement-style">How to say it</Label>
            <SelectRoot value={style} onValueChange={(v) => setStyle(v as Style)} disabled={!canManage}>
              <SelectTrigger id="announcement-style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Don’t announce it</SelectItem>
                <SelectItem value="BAR">A bar across the top</SelectItem>
                <SelectItem value="MODAL">A pop-up, once per customer</SelectItem>
              </SelectContent>
            </SelectRoot>
            <FieldDescription>{STYLE_HINT[style]}</FieldDescription>
          </Field>

          {style !== 'NONE' && (
            <>
              <Field>
                <Label htmlFor="announcement-text">
                  What it says <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="announcement-text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  disabled={!canManage}
                  maxLength={160}
                  placeholder="e.g. Christmas sale — 20% off everything until the 26th"
                  aria-invalid={touched && Boolean(problems.text)}
                />
                <FieldDescription>{160 - text.length} characters left.</FieldDescription>
                {touched && problems.text && <FieldError>{problems.text}</FieldError>}
              </Field>

              {style === 'MODAL' && (
                <>
                  <Field>
                    <Label htmlFor="announcement-detail">Description</Label>
                    <Textarea
                      id="announcement-detail"
                      value={detail}
                      onChange={(event) => setDetail(event.target.value)}
                      disabled={!canManage}
                      rows={3}
                      placeholder="e.g. Orders for sale items are dispatched from the 27th. Everything else ships as usual."
                    />
                    <FieldDescription>
                      Anything customers need to know — delivery timing, what’s excluded, when it ends.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <Label>Picture</Label>
                    <FieldDescription>
                      Sits across the top of the pop-up. A wide shot works best — something from the sale.
                    </FieldDescription>
                    <ImageUploader
                      purpose="campaigns"
                      value={image}
                      onChange={setImage}
                      max={1}
                      disabled={!canManage}
                      onBusyChange={setUploading}
                      hint="PNG, JPG or WebP, up to 10MB"
                    />
                  </Field>
                </>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <Label htmlFor="announcement-cta">Button</Label>
                  <Input
                    id="announcement-cta"
                    value={cta}
                    onChange={(event) => setCta(event.target.value)}
                    disabled={!canManage}
                    placeholder="Shop the sale"
                  />
                </Field>
                <Field>
                  <Label htmlFor="announcement-href">Where it goes</Label>
                  {/* Real places on this store, so the link can't point at a
                    * page the shop hasn't got. */}
                  <SelectRoot
                    value={href || 'none'}
                    onValueChange={(value) => setHref(value === 'none' ? '' : value)}
                    disabled={!canManage}
                  >
                    <SelectTrigger id="announcement-href">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nowhere — just the words</SelectItem>
                      {destinations.map((destination) => (
                        <SelectItem key={destination.href} value={destination.href}>
                          {destination.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>

                  {touched && (problems.href || problems.cta) && (
                    <FieldError>{problems.href ?? problems.cta}</FieldError>
                  )}
                </Field>
              </div>

              {style === 'BAR' && (
                <label className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">Scroll the text</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      For a notice too long to sit still. It stops for customers whose device asks for
                      less motion.
                    </span>
                  </span>
                  <SwitchRoot
                    checked={scroll}
                    onCheckedChange={setScroll}
                    disabled={!canManage}
                    aria-label="Scroll the text"
                  />
                </label>
              )}

              <Field>
                <Label>Colours</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ANNOUNCEMENT_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      disabled={!canManage}
                      onClick={() => {
                        setBackground(preset.background);
                        setForeground(preset.foreground);
                      }}
                      style={{ backgroundColor: preset.background, color: preset.foreground }}
                      className={cn(
                        'h-8 rounded-md border px-3 text-xs font-medium',
                        background === preset.background && 'ring-2 ring-ring ring-offset-1',
                      )}
                    >
                      {preset.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => {
                      setBackground('');
                      setForeground('');
                    }}
                    className="h-8 rounded-md border px-3 text-xs font-medium text-muted-foreground"
                  >
                    Store colours
                  </button>
                </div>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <Field>
                    <Label htmlFor="announcement-bg" className="text-xs font-normal text-muted-foreground">
                      Background
                    </Label>
                    <Input
                      id="announcement-bg"
                      value={background}
                      onChange={(event) => setBackground(event.target.value)}
                      disabled={!canManage}
                      placeholder="#b42318"
                      className="font-mono text-xs"
                      aria-invalid={touched && Boolean(problems.background)}
                    />
                    {touched && problems.background && <FieldError>{problems.background}</FieldError>}
                  </Field>
                  <Field>
                    <Label htmlFor="announcement-fg" className="text-xs font-normal text-muted-foreground">
                      Text
                    </Label>
                    <Input
                      id="announcement-fg"
                      value={foreground}
                      onChange={(event) => setForeground(event.target.value)}
                      disabled={!canManage}
                      placeholder="#ffffff"
                      className="font-mono text-xs"
                      aria-invalid={touched && Boolean(problems.foreground)}
                    />
                    {touched && problems.foreground && <FieldError>{problems.foreground}</FieldError>}
                  </Field>
                </div>
                <FieldDescription>
                  Leave both empty to use your store’s own colours.
                </FieldDescription>
              </Field>
            </>
          )}

          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={save} disabled={saving || uploading}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Save announcement
              </Button>

              {/* Opens the shop with the announcement forced on, so checking
                * it doesn't mean closing it and then clearing site data to
                * get it back. The preview records nothing. */}
              {campaign.phase === 'ACTIVE' && a.style !== 'NONE' && a.text && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`${storeUrl}?${ANNOUNCEMENT_PREVIEW_PARAM}=1`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="size-3.5" />
                    See it on your store
                  </a>
                </Button>
              )}
            </div>
          )}

          {canManage && campaign.phase !== 'ACTIVE' && style !== 'NONE' && (
            <p className="text-xs text-muted-foreground">
              Customers will see this while the campaign is running. It isn’t on your store yet.
            </p>
          )}
        </div>

        {/* ── What the customer will see ──────────────────────────── */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">What customers will see</p>

          {style === 'NONE' || !text.trim() ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {style === 'NONE'
                ? 'Nothing. Your sale prices still show on your products.'
                : 'Write something and it will appear here.'}
            </div>
          ) : style === 'BAR' ? (
            <div className="overflow-hidden rounded-lg border">
              <div
                style={swatch}
                className={cn(
                  'flex items-center justify-center gap-3 px-4 py-2 text-sm',
                  !isHexColour(background) && 'bg-primary text-primary-foreground',
                )}
              >
                <span className={cn('truncate', scroll && 'animate-pulse')}>{text}</span>
                {cta.trim() && <span className="shrink-0 underline underline-offset-2">{cta}</span>}
              </div>
              <div className="bg-muted/40 px-4 py-6 text-center text-xs text-muted-foreground">
                {storeName}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/40 p-6">
              <div className="mx-auto max-w-xs overflow-hidden rounded-2xl bg-background shadow-sm">
                {image[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image[0].url} alt="" className="aspect-[4/3] w-full object-cover" />
                )}
                <div
                  style={swatch}
                  className={cn('px-4 py-4 text-center', !isHexColour(background) && 'bg-background')}
                >
                  <p className="text-base font-semibold leading-tight">{text}</p>
                  {detail.trim() && (
                    <p className="mt-2 whitespace-pre-line text-xs leading-relaxed opacity-85">{detail}</p>
                  )}
                  {cta.trim() && (
                    <span
                      style={
                        isHexColour(background)
                          ? {
                              backgroundColor: isHexColour(foreground) ? foreground : '#ffffff',
                              color: background,
                            }
                          : undefined
                      }
                      className={cn(
                        'mt-3 flex h-9 items-center justify-center rounded-full text-xs font-semibold',
                        !isHexColour(background) && 'bg-primary text-primary-foreground',
                      )}
                    >
                      {cta}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {style === 'BAR' && scroll && (
            <p className="text-xs text-muted-foreground">
              On your store the text scrolls across. It sits still for customers who’ve asked their
              device for less motion.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
