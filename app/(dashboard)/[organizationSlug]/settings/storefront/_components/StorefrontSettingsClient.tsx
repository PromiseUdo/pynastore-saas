'use client';

/*
 * Settings → Storefront: how the shop shows up in search results and when
 * someone shares its link, and the merchant's own tracking ids.
 *
 * The shop's LOOK and its front-page slides moved to Online store →
 * Customize (ROADMAP 15.1); this page points there rather than repeating
 * them.
 *
 * Nothing here has a default sentence. Leaving a field empty gives the
 * storefront's own behaviour, not a line written on the merchant's behalf.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, ExternalLink, Loader2, MessagesSquare, Paintbrush, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription } from '@/components/ui/form-field';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { ImageUploader, type UploadedImage } from '@/components/media/image-uploader';
import {
  saveStorefrontAppearance,
  saveStorefrontChat,
  type StorefrontAppearance,
  type StorefrontChatSettings,
} from '@/features/settings/storefront';
import { CHAT_GREETING_MAX } from '@/lib/chat/rules';

export function StorefrontSettingsClient({
  appearance,
  chat,
  canViewMessages,
  storeUrl,
  canManage,
  canCustomize,
}: {
  appearance: StorefrontAppearance;
  chat: StorefrontChatSettings;
  /** holds `messages.view`, so the Messages link will open for them */
  canViewMessages: boolean;
  storeUrl: string;
  canManage: boolean;
  /** holds `storefront.design`, so the Customize page will open for them */
  canCustomize: boolean;
}) {
  const router = useRouter();
  const [tagline, setTagline] = React.useState(appearance.tagline ?? '');
  const [gaId, setGaId] = React.useState(appearance.gaId ?? '');
  const [metaPixelId, setMetaPixelId] = React.useState(appearance.metaPixelId ?? '');
  const [socialImage, setSocialImage] = React.useState<UploadedImage[]>(
    appearance.socialImageUrl && appearance.socialImagePublicId
      ? [{ url: appearance.socialImageUrl, publicId: appearance.socialImagePublicId }]
      : [],
  );
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const result = await saveStorefrontAppearance({
      tagline,
      socialImage: socialImage[0] ? { url: socialImage[0].url, publicId: socialImage[0].publicId } : null,
      gaId,
      metaPixelId,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success('Storefront settings saved');
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Storefront"
        description="How your online shop appears in search results and shared links, and your tracking."
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href={storeUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              Visit your store
            </a>
          </Button>
        }
      />

      <PageBody className="max-w-4xl space-y-6">
        {canCustomize && (
          <Link
            href="/online-store/customize"
            className="flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
          >
            <Paintbrush className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Looking for colours, fonts or front page slides?</span>
              <span className="block text-xs text-muted-foreground">They’re in Online store → Customize.</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}

        <ChatSettings chat={chat} canManage={canManage} canViewMessages={canViewMessages} />

        <section className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Search className="size-4" aria-hidden />
              Search results and shared links
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              What people see on Google, and when your shop is shared on WhatsApp or Instagram.
            </p>
          </div>

          <Field>
            <Label htmlFor="tagline">One line about your shop</Label>
            <Textarea
              id="tagline"
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              disabled={!canManage}
              rows={2}
              maxLength={200}
              placeholder="e.g. Hand-dyed adire and ready-to-wear, made in Abeokuta and delivered nationwide."
            />
            <FieldDescription>
              {200 - tagline.length} characters left. This is never shown on your shop itself.
            </FieldDescription>
          </Field>

          <Field>
            <Label>Share picture</Label>
            <FieldDescription>
              Shown when someone pastes a link to your shop. Wide works best. Without one we use your logo.
            </FieldDescription>
            <ImageUploader
              purpose="storefront"
              value={socialImage}
              onChange={setSocialImage}
              max={1}
              disabled={!canManage}
              onBusyChange={setUploading}
              hint="PNG, JPG or WebP, up to 10MB"
            />
          </Field>
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <h2 className="text-sm font-semibold">Tracking</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Paste in ids from your own accounts. Nothing is loaded on your shop unless you fill these in.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="ga">Google Analytics</Label>
              <Input
                id="ga"
                value={gaId}
                onChange={(event) => setGaId(event.target.value)}
                disabled={!canManage}
                placeholder="G-XXXXXXXXXX"
                className="font-mono text-xs"
              />
            </Field>
            <Field>
              <Label htmlFor="pixel">Meta pixel</Label>
              <Input
                id="pixel"
                value={metaPixelId}
                onChange={(event) => setMetaPixelId(event.target.value)}
                disabled={!canManage}
                placeholder="1234567890123456"
                className="font-mono text-xs"
              />
            </Field>
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {canManage && (
            <Button size="sm" onClick={save} disabled={saving || uploading}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save storefront settings
            </Button>
          )}
        </section>
      </PageBody>
    </>
  );
}

/**
 * Messages (ROADMAP 17): whether shoppers can message the shop. Off until
 * the merchant turns it on — a chat nobody answers is worse than none — and
 * the greeting is theirs to write or leave out.
 */
function ChatSettings({
  chat,
  canManage,
  canViewMessages,
}: {
  chat: StorefrontChatSettings;
  canManage: boolean;
  canViewMessages: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(chat.enabled);
  const [greeting, setGreeting] = React.useState(chat.greeting ?? '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const changed = enabled !== chat.enabled || greeting.trim() !== (chat.greeting ?? '');

  async function save() {
    setSaving(true);
    setError(null);
    const result = await saveStorefrontChat({ enabled, greeting });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(enabled ? 'Chat is on — shoppers can message your shop' : 'Chat is off');
    router.refresh();
  }

  return (
    <section id="chat" className="scroll-mt-6 space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <MessagesSquare className="size-4" aria-hidden />
          Chat with shoppers
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Let shoppers send your shop a message from your online store. You reply in{' '}
          {canViewMessages ? (
            <Link href="/messages" className="font-medium text-primary hover:underline">
              Messages
            </Link>
          ) : (
            'Messages'
          )}
          .
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="chat-enabled">Let shoppers message you</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Only turn this on if someone will answer. Shoppers see a “Message the store” button; turning it off hides it
            but keeps every conversation.
          </p>
        </div>
        <SwitchRoot
          id="chat-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!canManage}
          className="mt-0.5"
        />
      </div>

      <Field>
        <Label htmlFor="chat-greeting">Greeting (optional)</Label>
        <Textarea
          id="chat-greeting"
          value={greeting}
          onChange={(event) => setGreeting(event.target.value)}
          disabled={!canManage}
          rows={2}
          maxLength={CHAT_GREETING_MAX}
          placeholder="e.g. Hi! Ask us about sizes, delivery or anything else — we usually reply the same day."
        />
        <FieldDescription>
          Shown at the top of the chat, in your words. Leave it empty and shoppers see a plain “Send the shop a message”.
          Only promise reply times you can keep. {CHAT_GREETING_MAX - greeting.length} characters left.
        </FieldDescription>
      </Field>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {canManage && (
        <Button size="sm" onClick={save} disabled={saving || !changed}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save chat settings
        </Button>
      )}
    </section>
  );
}
