import Link from 'next/link';
import { PLATFORM_NAME, PLATFORM_OPERATOR, PLATFORM_SUPPORT_EMAIL } from '@/lib/brand';
import { SupportChatLink } from './support-chat';
import { supportChatOn } from './support-chat-mount';
import { Wordmark } from './wordmark';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/pricing', label: 'Pricing' },
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
  const chat = supportChatOn();
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-12 pt-16 sm:px-6 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="space-y-4">
          <Wordmark />
          <p className="max-w-xs text-[14.5px] leading-relaxed text-muted-foreground">
            Stock, sales, delivery and payments for shops that sell at a counter, online, or both.
          </p>
          <div className="text-[14.5px]">
            <p className="font-medium text-foreground">Got a question?</p>
            <p className="mt-1 text-muted-foreground">
              {chat && (
                <>
                  <SupportChatLink className="font-medium text-primary underline-offset-4 hover:underline">Chat with us</SupportChatLink>
                  {' or email '}
                </>
              )}
              <a href={`mailto:${PLATFORM_SUPPORT_EMAIL}`} className="font-medium text-primary underline-offset-4 hover:underline">
                {PLATFORM_SUPPORT_EMAIL}
              </a>
            </p>
          </div>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="text-[13px] font-semibold text-foreground">{col.title}</h2>
            <ul className="mt-4 space-y-3 text-[14.5px]">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-muted-foreground transition-colors hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-6 text-[13px] text-muted-foreground sm:px-6">
          © {new Date().getFullYear()} {PLATFORM_NAME}. Operated by {PLATFORM_OPERATOR}, Nigeria.
        </p>
      </div>
    </footer>
  );
}
