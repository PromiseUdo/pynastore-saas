'use client';

/*
 * Storefront light/dark switch. The palette, cookie and default are all
 * documented in lib/storefront/theme.ts — this file is only the control.
 *
 * Toggling writes the cookie (so the next SSR render is already correct) AND
 * flips the attribute in place, so the change is instant with no navigation.
 */
import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStorefront } from '@/lib/storefront/context';
import { DEFAULT_SF_THEME, themeCookie, type SfTheme } from '@/lib/storefront/theme';

function root(): HTMLElement | null {
  return typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('[data-storefront]');
}

export function ThemeToggle({ className }: { className?: string }) {
  const { org } = useStorefront();
  // Seeded from the server-rendered attribute, so the first client render
  // matches the HTML and there is nothing to reconcile.
  const [theme, setTheme] = React.useState<SfTheme>(DEFAULT_SF_THEME);

  React.useEffect(() => {
    setTheme(root()?.dataset.sfTheme === 'dark' ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    const el = root();
    if (!el) return;
    const next: SfTheme = theme === 'dark' ? 'light' : 'dark';
    // Cream is the default, so it is represented by the ABSENCE of the attr.
    if (next === 'dark') el.dataset.sfTheme = 'dark';
    else delete el.dataset.sfTheme;
    document.cookie = themeCookie(org.slug, next);
    setTheme(next);
  };

  const isLight = theme === 'light';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      title={isLight ? 'Dark theme' : 'Light theme'}
      className={cn(
        'flex size-8 items-center justify-center rounded-full opacity-75 transition hover:bg-white/10 hover:opacity-100',
        className,
      )}
    >
      {isLight ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  );
}
