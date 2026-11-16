'use client';

/*
 * "Chat with us" on the platform's public pages (ROADMAP 23).
 *
 * Our button, Freshchat's conversation — everything after the press happens
 * inside Freshchat's own window (its topics, its away message and its
 * offline email form are set up in Freshchat). Freshchat's own bubble stays
 * hidden, so this is the only way in.
 *
 * Freshchat loads in the background once the page has finished loading
 * (the owner's call, 2026-11-16), so the window is ready when the button is
 * pressed — the widget is a chain of downloads (about 2.7 MB, ~3 s on a fast
 * line) and making a visitor wait for it after the press felt broken. It
 * waits for the browser to be idle, so the page itself is never slowed. A
 * press before it's ready still works: the button shows a spinner until it is.
 *
 * Elsewhere on the page, <SupportChatLink> opens the same thing — the
 * pricing page's "Not sure which plan fits?" and the footer.
 *
 * If the widget can't load (an ad blocker, a network failure) the button
 * becomes "Email us" — never a button that does nothing.
 */
import * as React from 'react';
import { Loader2, Mail, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FcWidget {
  init(options: Record<string, unknown>): void;
  open(): void;
  on(event: string, cb: () => void): void;
}
declare global {
  interface Window {
    fcWidget?: FcWidget;
  }
}

export interface SupportChatProps {
  host: string;
  token: string;
  widgetUuid: string | null;
  email: string;
}

const OPEN_EVENT = 'support-chat:open';
const LOAD_TIMEOUT_MS = 20_000;

/** Opens the chat from anywhere on the page. Render it only when the chat is set up. */
export function SupportChatLink({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))} className={className}>
      {children}
    </button>
  );
}

/* ── loading the widget, once per page ─────────────────────────────────── */

let loading: Promise<FcWidget> | null = null;

function loadWidget({ host, token, widgetUuid }: Pick<SupportChatProps, 'host' | 'token' | 'widgetUuid'>): Promise<FcWidget> {
  if (loading) return loading;
  loading = new Promise<FcWidget>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS);
    const start = () => {
      const widget = window.fcWidget;
      if (!widget) return reject(new Error('no widget'));
      widget.on('widget:loaded', () => {
        window.clearTimeout(timer);
        resolve(widget);
      });
      widget.init({
        token,
        host,
        ...(widgetUuid ? { widgetUuid } : {}),
        // Our button is the way in; Freshchat's bubble would be a second one.
        config: { headerProperty: { hideChatButton: true } },
      });
    };
    // Allowed by the page's CSP: inserted by our own (nonced) script, under 'strict-dynamic'.
    const script = document.createElement('script');
    script.src = `${host}/js/widget.js`;
    script.async = true;
    script.onload = start;
    script.onerror = () => reject(new Error('blocked'));
    document.body.appendChild(script);
  }).catch((error) => {
    loading = null; // let a later press try again
    throw error;
  });
  return loading;
}

/* ── the button ────────────────────────────────────────────────────────── */

export function SupportChat({ host, token, widgetUuid, email }: SupportChatProps) {
  const [state, setState] = React.useState<'idle' | 'opening' | 'failed'>('idle');

  // Load in the background once the page is done and the browser is idle.
  // If the script is blocked outright (an ad blocker), say so now: the button
  // becomes "Email us". Anything else (a slow line) is left for the press to
  // retry and report.
  React.useEffect(() => {
    let cancelled = false;
    const start = () =>
      loadWidget({ host, token, widgetUuid }).catch((error: Error) => {
        if (!cancelled && error.message === 'blocked') setState('failed');
      });
    // Safari has no requestIdleCallback; a short delay does the same job there.
    const idle = () => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => void start(), { timeout: 4000 });
      else setTimeout(() => void start(), 1500);
    };
    if (document.readyState === 'complete') idle();
    else window.addEventListener('load', idle, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', idle);
    };
  }, [host, token, widgetUuid]);

  const open = React.useCallback(async () => {
    setState('opening');
    try {
      const widget = await loadWidget({ host, token, widgetUuid });
      widget.open();
      setState('idle');
    } catch {
      setState('failed');
    }
  }, [host, token, widgetUuid]);

  React.useEffect(() => {
    const onOpen = () => void open();
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [open]);

  const placement = 'h-11 gap-2 rounded-full px-5 shadow-lg';

  return (
    <div className="fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
      {state === 'failed' ? (
        <Button asChild className={placement}>
          <a href={`mailto:${email}`} title="The chat couldn’t open on this device — email us instead">
            <Mail className="size-4" aria-hidden />
            Email us
          </a>
        </Button>
      ) : (
        <Button
          type="button"
          onClick={() => void open()}
          disabled={state === 'opening'}
          aria-busy={state === 'opening'}
          className={placement}
        >
          {state === 'opening' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MessageCircle className="size-4" aria-hidden />}
          Chat with us
        </Button>
      )}
    </div>
  );
}
