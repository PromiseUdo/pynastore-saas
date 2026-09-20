'use client';

/*
 * The conversation surface.
 *
 * Layout is a three-part column — scrolling transcript, quick prompts,
 * pinned composer — so the input is always reachable without scrolling,
 * which is the thing that matters most on a phone (§41). The composer
 * carries `safe-bottom` for the home indicator inside the Capacitor shell,
 * and the transcript scrolls under it rather than the whole panel moving
 * when the keyboard opens.
 *
 * All it knows about the assistant is the store and the response shape: it
 * calls `send()` and renders what comes back. No provider, no AI SDK, no
 * prompt text (§34/§42).
 */
import * as React from 'react';
import { Loader2, RotateCcw, Send, Sparkles } from 'lucide-react';
import { useStorefront } from '@/lib/storefront/context';
import { useAssistantStore } from '@/lib/storefront/stores/assistant-store';
import { openingLineFor, quickPromptsFor } from '@/lib/ai/assistant/prompts';
import { AssistantAnswer } from './assistant-answer';

/*
 * The page context is read from the store rather than taken as a prop: the
 * store is what `send()` attaches to each request, and a second copy passed
 * down the tree is a second thing to keep in step. One source, so what the
 * panel says it is about and what the request carries cannot disagree.
 */
export function AssistantPanel() {
  const { org } = useStorefront();
  const seed = useAssistantStore((s) => s.seed) ?? { surface: 'home' as const };
  const messages = useAssistantStore((s) => s.messages);
  const status = useAssistantStore((s) => s.status);
  const error = useAssistantStore((s) => s.error);
  const send = useAssistantStore((s) => s.send);
  const reset = useAssistantStore((s) => s.reset);

  const [draft, setDraft] = React.useState('');
  const transcriptRef = React.useRef<HTMLDivElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  const ask = React.useCallback(
    (text: string) => {
      setDraft('');
      void send(text, org.slug);
    },
    [send, org.slug],
  );

  /* Keep the newest turn in view as the conversation grows. */
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: messages.length > 1 ? 'smooth' : 'auto' });
  }, [messages.length, status]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text) ask(text);
  };

  const prompts = quickPromptsFor(seed.surface);
  const empty = messages.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── transcript ──────────────────────────────────────────────── */}
      <div
        ref={transcriptRef}
        className="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-5"
        /* Answers are announced as they land; `polite` so a screen reader
         * finishes the shopper's own input first. */
        aria-live="polite"
        aria-busy={status === 'thinking'}
      >
        {empty && (
          <div className="py-4">
            <span className="flex size-10 items-center justify-center rounded-full bg-teal-soft">
              <Sparkles aria-hidden className="size-5 text-teal" />
            </span>
            <h3 className="mt-4 text-lg font-semibold">Shopping assistant</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
              {openingLineFor(seed.surface, seed.productName)}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Everything it tells you comes from {org.name}&rsquo;s own product listings — it
              won&rsquo;t make things up, and it will say when it doesn&rsquo;t know.
            </p>
          </div>
        )}

        {messages.map((message) =>
          message.role === 'user' ? (
            /* The shopper's words, set apart by weight and a rule rather
             * than a coloured bubble — this is a shopping tool. */
            <p
              key={message.id}
              className="border-l-2 border-brand pl-3 text-[0.9375rem] font-semibold"
            >
              <span className="sr-only">You asked: </span>
              {message.text}
            </p>
          ) : message.response ? (
            <AssistantAnswer key={message.id} response={message.response} onAsk={ask} />
          ) : (
            <p key={message.id} className="text-[0.9375rem] leading-relaxed">
              {message.text}
            </p>
          ),
        )}

        {status === 'thinking' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Looking through the store…
          </p>
        )}

        {status === 'error' && error && (
          <div role="alert" className="rounded-xl bg-secondary p-4 text-sm">
            {error}
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* ── quick prompts ───────────────────────────────────────────── */}
      {empty && (
        <div className="shrink-0 border-t px-5 py-3">
          <p id="sf-assistant-prompts" className="text-xs font-medium text-muted-foreground">
            Try one of these
          </p>
          {/* Wraps rather than scrolls: a hidden chip off the right edge is
            * a chip nobody taps. */}
          <ul aria-labelledby="sf-assistant-prompts" className="mt-2 flex flex-wrap gap-2">
            {prompts.map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  onClick={() => ask(prompt)}
                  className="inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand"
                >
                  {prompt}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── composer ────────────────────────────────────────────────── */}
      <form
        onSubmit={onSubmit}
        className="safe-bottom shrink-0 border-t bg-background px-5 py-3"
      >
        <label htmlFor="sf-assistant-input" className="sr-only">
          Ask the shopping assistant about products in this store
        </label>
        <div className="flex items-end gap-2">
          <input
            id="sf-assistant-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about anything in this store…"
            autoComplete="off"
            maxLength={500}
            /* 16px minimum stops iOS zooming the viewport on focus. */
            className="h-12 min-w-0 flex-1 rounded-full border bg-card px-4 text-base outline-none transition-colors focus:border-brand sm:text-[0.9375rem]"
          />
          <button
            type="submit"
            disabled={!draft.trim() || status === 'thinking'}
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-40"
          >
            {status === 'thinking' ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Send aria-hidden className="size-4" />
            )}
            <span className="sr-only">Send message</span>
          </button>
        </div>

        {!empty && (
          <button
            type="button"
            onClick={reset}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw aria-hidden className="size-3" />
            Start over
          </button>
        )}
      </form>
    </div>
  );
}
