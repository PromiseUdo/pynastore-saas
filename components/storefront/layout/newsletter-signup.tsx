'use client';

import * as React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Dummy newsletter capture — no network, just an optimistic thank-you.
 *
 * `tone="inverse"` is for placement on the ink band, where the default
 * bordered input would disappear.
 */
export function NewsletterSignup({
  className,
  tone = 'default',
}: {
  className?: string;
  tone?: 'default' | 'inverse';
}) {
  const [email, setEmail] = React.useState('');
  const [done, setDone] = React.useState(false);
  const inverse = tone === 'inverse';

  if (done) {
    return (
      <p
        className={cn(
          'flex items-center gap-2 text-sm font-medium',
          inverse ? 'text-primary-foreground' : 'text-teal',
          className,
        )}
      >
        <Check className="size-4 shrink-0" /> Thanks — check your inbox to confirm.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (/.+@.+\..+/.test(email)) setDone(true);
      }}
      className={cn(
        'flex items-center gap-2 rounded-full p-1.5',
        inverse ? 'bg-primary-foreground/10' : 'border border-border bg-card',
        className,
      )}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Your email address"
        aria-label="Email address"
        className={cn(
          // min-w-0 lets the input shrink inside the flex row instead of
          // pushing the button out of the pill.
          'h-11 min-w-0 flex-1 bg-transparent px-4 text-sm outline-none',
          inverse
            ? 'text-primary-foreground placeholder:text-primary-foreground/50'
            : 'placeholder:text-muted-foreground',
        )}
      />
      <button
        type="submit"
        className={cn(
          'group flex h-11 shrink-0 items-center gap-1.5 rounded-full px-5 text-sm font-semibold transition-opacity hover:opacity-90',
          inverse ? 'bg-highlight text-highlight-foreground' : 'bg-brand text-primary-foreground',
        )}
      >
        Join
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </form>
  );
}
