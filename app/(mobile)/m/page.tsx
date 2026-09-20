'use client';

/*
 * Store-picker STUB for the mobile app. Placeholder only — the real picker
 * (recent stores, search, deep-link handling, branding) is part of the
 * future storefront build. It navigates to /s/{slug}, which proxy.ts maps
 * to that tenant's storefront.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function MobileStorePickerPage() {
  const router = useRouter();
  const [slug, setSlug] = useState('');

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const s = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (s) router.push(`/s/${s}`);
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Find a store</h1>
        <p className="text-sm text-muted-foreground">
          Enter a store handle to start shopping.
        </p>
      </div>

      <form onSubmit={go} className="flex w-full max-w-xs flex-col gap-3">
        <input
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          placeholder="store-handle"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-center text-base outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={!slug.trim()}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Continue
        </button>
      </form>
    </main>
  );
}
