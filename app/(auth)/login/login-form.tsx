'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { loginAction, googleSignInAction, appleSignInAction, type LoginState } from './actions';
import { SignInProviders, providerErrorMessage } from '@/components/auth/sign-in-providers';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/** The page to land on after an in-app sign-in: the callback's path, on the business host. */
function nextFrom(callbackUrl: string | null): string {
  if (!callbackUrl) return '/';
  try {
    const url = new URL(callbackUrl, 'http://placeholder');
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}

export function LoginForm({ apple }: { apple: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    loginAction,
    null,
  );
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl');
  const providerError = providerErrorMessage(searchParams.get('error'));
  const deleted = searchParams.get('deleted') === '1';

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome back to your workspace
        </p>
      </div>

      {deleted && (
        <p role="status" className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-xs text-foreground">
          Your account has been deleted, and you’ve been signed out.
        </p>
      )}

      {providerError && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {providerError}
        </p>
      )}

      {/* Google and Apple — in the business app they run in the sign-in sheet (ROADMAP 19.2) */}
      <SignInProviders
        googleAction={googleSignInAction}
        appleAction={apple ? appleSignInAction : null}
        hidden={{ callbackUrl }}
        next={nextFrom(callbackUrl)}
      />

      {/* Divider */}
      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Credentials form */}
      <form action={action} className="space-y-4">
        {/* Pass callbackUrl through so the action can use it */}
        {callbackUrl && (
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>

        {state?.error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {state.error}
          </p>
        )}

        <Button type="submit" className="w-full" size="sm" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link
          href={
            callbackUrl?.startsWith('/invite/')
              ? `/register?invite=${encodeURIComponent(callbackUrl.replace('/invite/', ''))}`
              : '/register'
          }
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
