import Link from 'next/link';
import { PLATFORM_CONTACT_EMAIL, PLATFORM_NAME, PLATFORM_OPERATOR } from '@/lib/brand';
import { Wordmark } from './wordmark';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/#faq', label: 'Questions' },
    ],
  },
  {
    title: 'Account',
    links: [
      { href: '/register', label: 'Start free trial' },
      { href: '/login', label: 'Sign in' },
      { href: '/forgot-password', label: 'Reset password' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Policy' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <Wordmark />
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            Stock, sales, delivery and payments for businesses that sell at a counter, online, or both.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{col.title}</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-foreground/80 transition-colors hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} {PLATFORM_NAME}. Operated by {PLATFORM_OPERATOR}, Nigeria.
          </p>
          <p>
            Questions?{' '}
            <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="underline-offset-4 hover:text-foreground hover:underline">
              {PLATFORM_CONTACT_EMAIL}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
