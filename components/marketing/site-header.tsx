'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Wordmark } from './wordmark';

const NAV = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/#faq', label: 'Questions' },
];

export function SiteHeader() {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setOpen(false), [pathname]);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // The menu sits over the page: Escape closes it, and so does a tap outside (the backdrop).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Outside the header: its backdrop-blur would make it the box a fixed child is measured against. */}
      {open && (
        <div
          aria-hidden
          className="fixed inset-x-0 bottom-0 top-16 z-30 bg-[#11211a]/30 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <header
        className={cn(
          'sticky top-0 z-40 border-b transition-colors',
          open ? 'border-border/80 bg-background' : scrolled ? 'border-border/80 bg-background/90 backdrop-blur-md' : 'border-transparent bg-background',
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <Wordmark />
          <nav aria-label="Main" className="hidden items-center gap-1 text-[14.5px] md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                className={cn(
                  'rounded-full px-3.5 py-2 text-foreground/70 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  pathname === item.href && 'font-medium text-foreground',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-1.5 md:flex">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-[14.5px] font-medium text-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-[14.5px] font-semibold text-primary-foreground transition-colors hover:bg-[#0b5a3b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Start free trial
            </Link>
          </div>
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-full text-foreground hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {open && (
          <nav
            id="mobile-nav"
            aria-label="Main"
            className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-t bg-background px-4 pb-6 pt-2 shadow-[0_24px_40px_-12px_rgba(17,33,26,0.35)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 md:hidden"
          >
            <ul className="divide-y">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="block py-3.5 text-base font-medium text-foreground" onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/login" className="block py-3.5 text-base font-medium text-foreground">
                  Sign in
                </Link>
              </li>
            </ul>
            <Link
              href="/register"
              className="mt-3 flex h-12 items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-primary-foreground"
            >
              Start free trial
            </Link>
          </nav>
        )}
      </header>
    </>
  );
}
