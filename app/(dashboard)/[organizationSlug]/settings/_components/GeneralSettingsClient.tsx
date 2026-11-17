'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError, FormGrid, FormSection } from '@/components/ui/form-field';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { ImageUploader, type UploadedImage } from '@/components/media/image-uploader';
import {
  saveOrganizationSettings,
  type OrganizationFieldErrors,
  type OrganizationSettings,
} from '@/features/settings/organization';
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_INFO, type SocialPlatform } from '@/lib/storefront/social-links';
import { checkLogoForDarkMode } from '@/lib/storefront/design/logo-contrast';

type Currency = { code: string; label: string };

export function GeneralSettingsClient({
  settings,
  canManage,
  storeUrl,
  currencies,
}: {
  settings: OrganizationSettings;
  canManage: boolean;
  storeUrl: string;
  currencies: Currency[];
}) {
  const router = useRouter();

  const [name, setName] = React.useState(settings.name);
  const [supportEmail, setSupportEmail] = React.useState(settings.supportEmail ?? '');
  const [supportPhone, setSupportPhone] = React.useState(settings.supportPhone ?? '');
  const [businessAddress, setBusinessAddress] = React.useState(settings.businessAddress ?? '');
  const [vatRegistered, setVatRegistered] = React.useState(settings.vatRegistered);
  const [vatRate, setVatRate] = React.useState(String(settings.vatRate));
  const [vatNumber, setVatNumber] = React.useState(settings.vatNumber ?? '');
  const [socialLinks, setSocialLinks] = React.useState<Record<SocialPlatform, string>>(settings.socialLinks);
  const [logo, setLogo] = React.useState<UploadedImage[]>(
    settings.logoUrl && settings.logoPublicId
      ? [{ url: settings.logoUrl, publicId: settings.logoPublicId }]
      : [],
  );
  const [logoDark, setLogoDark] = React.useState<UploadedImage[]>(
    settings.logoDarkUrl && settings.logoDarkPublicId ? [{ url: settings.logoDarkUrl, publicId: settings.logoDarkPublicId }] : [],
  );
  const [favicon, setFavicon] = React.useState<UploadedImage[]>(
    settings.faviconUrl && settings.faviconPublicId
      ? [{ url: settings.faviconUrl, publicId: settings.faviconPublicId }]
      : [],
  );

  const [logoUploading, setLogoUploading] = React.useState(false);
  const [faviconUploading, setFaviconUploading] = React.useState(false);
  const [logoDarkUploading, setLogoDarkUploading] = React.useState(false);
  const uploading = logoUploading || faviconUploading || logoDarkUploading;

  /* Will the logo disappear on the shop's dark mode? Asked only while there's
   * no light version; can't-tell says nothing. */
  const logoUrl = logo[0]?.url ?? null;
  const [hiddenOnDark, setHiddenOnDark] = React.useState<{ url: string; hidden: boolean } | null>(null);
  React.useEffect(() => {
    if (!logoUrl || logoDark.length) return;
    let live = true;
    void checkLogoForDarkMode(logoUrl).then((hidden) => {
      if (live && hidden !== null) setHiddenOnDark({ url: logoUrl, hidden });
    });
    return () => {
      live = false;
    };
  }, [logoUrl, logoDark.length]);
  const warnDark = Boolean(logoUrl) && !logoDark.length && hiddenOnDark?.url === logoUrl && hiddenOnDark.hidden;
  const [pending, setPending] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<OrganizationFieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const currency = currencies.find((c) => c.code === settings.currency);

  /* Uploading an image only stores the file; nothing changes on the shop until
   * the form is saved. The header's Save button is off-screen by the time
   * someone reaches the images, so a bar follows them while anything differs
   * from what was last saved. */
  const snapshot = JSON.stringify({
    name,
    supportEmail,
    supportPhone,
    businessAddress,
    vatRegistered,
    vatRate,
    vatNumber,
    socialLinks,
    logo: logo[0]?.publicId ?? null,
    favicon: favicon[0]?.publicId ?? null,
    logoDark: logoDark[0]?.publicId ?? null,
  });
  const [savedSnapshot, setSavedSnapshot] = React.useState(snapshot);
  const dirty = canManage && snapshot !== savedSnapshot;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || pending || uploading) return;

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    const result = await saveOrganizationSettings({
      name,
      logo: logo[0] ? { url: logo[0].url, publicId: logo[0].publicId } : null,
      favicon: favicon[0] ? { url: favicon[0].url, publicId: favicon[0].publicId } : null,
      logoDark: logoDark[0] ? { url: logoDark[0].url, publicId: logoDark[0].publicId } : null,
      supportEmail,
      supportPhone,
      businessAddress,
      socialLinks,
      vatRegistered,
      // Only checked when VAT is on; off, the saved rate is kept for next time.
      vatRate: vatRegistered ? Number(vatRate.replace('%', '').trim()) : undefined,
      vatNumber,
    });
    setPending(false);

    if (!result.success) {
      if ('fieldErrors' in result) setFieldErrors(result.fieldErrors);
      setFormError(result.error);
      toast.error(result.error);
      return;
    }

    setSavedSnapshot(snapshot);
    toast.success('Business details saved');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <PageHeader
        title="Business details"
        description="Your business name, logo, tab icon, contact details, VAT and social media."
        actions={
          canManage ? (
            <Button type="submit" size="sm" disabled={pending || uploading}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Save changes
            </Button>
          ) : undefined
        }
      />

      <PageBody className="max-w-3xl space-y-8">
        {formError && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}

        <FormSection title="Business" description="What customers and your staff see this workspace called.">
          <Field>
            <Label htmlFor="name">
              Business name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage}
              aria-invalid={Boolean(fieldErrors.name)}
              required
            />
            {fieldErrors.name && <FieldError>{fieldErrors.name}</FieldError>}
          </Field>

          <Field>
            <Label>Logo</Label>
            <FieldDescription>
              Shown in the sidebar, on your online shop, and on what you send out. A square image works best.
            </FieldDescription>
            <ImageUploader
              purpose="organization"
              value={logo}
              onChange={setLogo}
              max={1}
              disabled={!canManage}
              onBusyChange={setLogoUploading}
              hint="PNG, JPG or WebP, up to 10MB"
            />
          </Field>

          <Field>
            <Label>Logo for dark mode</Label>
            <FieldDescription>
              Optional. Shoppers can switch your online shop to dark mode. If your logo is dark, add a light version (white or
              light-coloured, on a transparent background) to use there. Without one, dark mode shows your logo on a light
              backing so it stays visible.
            </FieldDescription>
            {warnDark && (
              <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                Your logo is dark on a transparent background, so it’s hard to see in dark mode. Add a light version here.
              </p>
            )}
            <ImageUploader
              purpose="organization"
              value={logoDark}
              onChange={setLogoDark}
              max={1}
              disabled={!canManage}
              onBusyChange={setLogoDarkUploading}
              hint="A PNG with a transparent background works best"
            />
          </Field>

          <Field>
            <Label>Browser tab icon</Label>
            <FieldDescription>
              The small picture beside your shop&apos;s name in a browser tab (a &ldquo;favicon&rdquo;). It shows at about
              16–32 pixels, so a simple square mark reads better than a full logo with words. Leave it empty to use your
              logo.
            </FieldDescription>
            <ImageUploader
              purpose="organization"
              value={favicon}
              onChange={setFavicon}
              max={1}
              disabled={!canManage}
              onBusyChange={setFaviconUploading}
              hint="A square PNG, at least 64 × 64 pixels"
            />
          </Field>

          <Field>
            <Label htmlFor="store-address">Web address</Label>
            <div className="flex items-center gap-2">
              <Input id="store-address" value={storeUrl} readOnly disabled className="font-mono text-xs" />
              <Button asChild variant="outline" size="sm">
                <Link href={storeUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                  Visit
                </Link>
              </Button>
            </div>
            <FieldDescription>
              This never changes — links your customers have saved keep working.
            </FieldDescription>
          </Field>

          <Field>
            <Label htmlFor="currency">Currency</Label>
            <Input id="currency" value={currency?.label ?? settings.currency} readOnly disabled />
            <FieldDescription>
              Every price, invoice and report in this workspace is in {currency?.label ?? settings.currency}.
              Changing it would not convert amounts already recorded, so get in touch if your business
              trades in another currency.
            </FieldDescription>
          </Field>
        </FormSection>

        <FormSection title="Contact" description="How customers reach you. Shown only where you've filled it in.">
          <FormGrid>
            <Field>
              <Label htmlFor="supportEmail">Email</Label>
              <Input
                id="supportEmail"
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                disabled={!canManage}
                aria-invalid={Boolean(fieldErrors.supportEmail)}
                placeholder="hello@yourbusiness.com"
              />
              {fieldErrors.supportEmail && <FieldError>{fieldErrors.supportEmail}</FieldError>}
            </Field>

            <Field>
              <Label htmlFor="supportPhone">Phone</Label>
              <Input
                id="supportPhone"
                value={supportPhone}
                onChange={(e) => setSupportPhone(e.target.value)}
                disabled={!canManage}
                aria-invalid={Boolean(fieldErrors.supportPhone)}
                placeholder="0801 234 5678"
              />
              {fieldErrors.supportPhone && <FieldError>{fieldErrors.supportPhone}</FieldError>}
            </Field>
          </FormGrid>

          <Field>
            <Label htmlFor="businessAddress">Address</Label>
            <Textarea
              id="businessAddress"
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
              disabled={!canManage}
              rows={3}
              aria-invalid={Boolean(fieldErrors.businessAddress)}
            />
            {fieldErrors.businessAddress && <FieldError>{fieldErrors.businessAddress}</FieldError>}
          </Field>
        </FormSection>

        <FormSection
          title="Tax"
          description="Whether your shop charges VAT. It applies to orders from now on; orders already placed keep what they had."
        >
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="vat-registered">VAT registered</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Turn on only if your business is registered for VAT. While it’s off, no VAT appears on your shop, receipts or
                orders.
              </p>
            </div>
            <SwitchRoot id="vat-registered" checked={vatRegistered} onCheckedChange={setVatRegistered} disabled={!canManage} />
          </div>

          {vatRegistered && (
            <FormGrid>
              <Field>
                <Label htmlFor="vat-rate">
                  VAT rate (%) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="vat-rate"
                  inputMode="decimal"
                  value={vatRate}
                  onChange={(e) => setVatRate(e.target.value)}
                  disabled={!canManage}
                  aria-invalid={Boolean(fieldErrors.vatRate)}
                  className="w-28 tabular-nums"
                />
                {fieldErrors.vatRate ? (
                  <FieldError>{fieldErrors.vatRate}</FieldError>
                ) : (
                  <FieldDescription>7.5% is Nigeria’s standard rate.</FieldDescription>
                )}
              </Field>
              <Field>
                <Label htmlFor="vat-number">VAT number</Label>
                <Input
                  id="vat-number"
                  value={vatNumber}
                  onChange={(e) => setVatNumber(e.target.value)}
                  disabled={!canManage}
                  aria-invalid={Boolean(fieldErrors.vatNumber)}
                />
                {fieldErrors.vatNumber ? (
                  <FieldError>{fieldErrors.vatNumber}</FieldError>
                ) : (
                  <FieldDescription>Printed on receipts and orders.</FieldDescription>
                )}
              </Field>
            </FormGrid>
          )}
          {vatRegistered && (
            <p className="text-xs text-muted-foreground">
              Your prices already include VAT: customers pay the price they see, and receipts show how much of it is VAT.
            </p>
          )}
        </FormSection>

        <FormSection
          title="Social media"
          description="Shown in your online shop's footer. Leave blank any you don't use."
        >
          <FormGrid>
            {SOCIAL_PLATFORMS.map((platform) => {
              const info = SOCIAL_PLATFORM_INFO[platform];
              const problem = fieldErrors[`social.${platform}`];
              return (
                <Field key={platform}>
                  <Label htmlFor={`social-${platform}`}>{info.label}</Label>
                  <Input
                    id={`social-${platform}`}
                    value={socialLinks[platform]}
                    onChange={(e) => setSocialLinks((links) => ({ ...links, [platform]: e.target.value }))}
                    disabled={!canManage}
                    aria-invalid={Boolean(problem)}
                    placeholder={info.placeholder}
                    inputMode={platform === 'whatsapp' ? 'tel' : 'url'}
                  />
                  {problem && <FieldError>{problem}</FieldError>}
                </Field>
              );
            })}
          </FormGrid>
        </FormSection>

        <FormSection title="Elsewhere" description="Settings that belong to another page.">
          <ul className="divide-y rounded-lg border bg-card text-sm">
            <SettingLink
              href="/settings/delivery"
              title="Delivery and returns"
              description="Delivery zones and prices, pickup points, and how long customers have to return something."
            />
            <SettingLink
              href="/settings/payments"
              title="Payment setup"
              description="How customers can pay, and the bank accounts behind bank transfer."
            />
            <SettingLink
              href="/settings/members"
              title="Team"
              description="Who can sign in to this workspace, and what they're allowed to do."
            />
          </ul>
        </FormSection>
        {dirty && (
          <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex items-center justify-between gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur-sm">
            <p className="text-sm text-muted-foreground">
              {uploading ? 'Uploading image…' : 'You have unsaved changes.'}
            </p>
            <Button type="submit" size="sm" disabled={pending || uploading}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Save changes
            </Button>
          </div>
        )}
      </PageBody>
    </form>
  );
}

function SettingLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <li>
      <Link href={href} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}
