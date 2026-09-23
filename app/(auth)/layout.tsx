import type { Metadata } from 'next';
import { PLATFORM_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: {
    default: 'Sign in',
    template: `%s · ${PLATFORM_NAME}`,
  },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-12">
      {/* Logo */}
      <a href="/" className="mb-8 flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          S
        </div>
        <span className="text-base font-semibold text-foreground">
          {PLATFORM_NAME}
        </span>
      </a>

      {/* Card */}
      <div className="w-full max-w-sm rounded-xl border bg-card shadow-sm">
        {children}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        By continuing, you agree to our{' '}
        <a
          href="/terms"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Terms of Service
        </a>{' '}
        and{' '}
        <a
          href="/privacy"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
