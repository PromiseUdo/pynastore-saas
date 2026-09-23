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
import { Field, FieldDescription, FieldError, FormGrid, FormSection } from '@/components/ui/form-field';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { ImageUploader, type UploadedImage } from '@/components/media/image-uploader';
import {
  saveOrganizationSettings,
  type OrganizationFieldErrors,
  type OrganizationSettings,
} from '@/features/settings/organization';

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
  const [logo, setLogo] = React.useState<UploadedImage[]>(
    settings.logoUrl && settings.logoPublicId
      ? [{ url: settings.logoUrl, publicId: settings.logoPublicId }]
      : [],
  );

  const [uploading, setUploading] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<OrganizationFieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const currency = currencies.find((c) => c.code === settings.currency);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || pending || uploading) return;

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    const result = await saveOrganizationSettings({
      name,
      logo: logo[0] ? { url: logo[0].url, publicId: logo[0].publicId } : null,
      supportEmail,
      supportPhone,
      businessAddress,
    });
    setPending(false);

    if (!result.success) {
      if ('fieldErrors' in result) setFieldErrors(result.fieldErrors);
      setFormError(result.error);
      return;
    }

    toast.success('Business details saved');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <PageHeader
        title="General"
        description="Your business name, logo and contact details."
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
              Shown in the sidebar and on what you send out. A square image works best.
            </FieldDescription>
            <ImageUploader
              purpose="organization"
              value={logo}
              onChange={setLogo}
              max={1}
              disabled={!canManage}
              onBusyChange={setUploading}
              hint="PNG, JPG or WebP, up to 10MB"
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

        <FormSection title="Elsewhere" description="Settings that belong to another page.">
          <ul className="divide-y rounded-lg border bg-card text-sm">
            <SettingLink
              href="/settings/delivery"
              title="Delivery and returns"
              description="Delivery zones and prices, pickup points, and how long customers have to return something."
            />
            <SettingLink
              href="/settings/payments"
              title="Payments"
              description="How customers can pay, and the bank accounts behind bank transfer."
            />
            <SettingLink
              href="/settings/members"
              title="Members"
              description="Who can sign in to this workspace, and what they're allowed to do."
            />
          </ul>
        </FormSection>
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
