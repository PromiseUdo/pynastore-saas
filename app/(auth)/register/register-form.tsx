'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  registerAction,
  googleSignInAction,
  appleSignInAction,
  type RegisterState,
} from './actions';
import { SignInProviders, providerErrorMessage } from '@/components/auth/sign-in-providers';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PLATFORM_NAME } from '@/lib/brand';

export function RegisterForm({ apple }: { apple: boolean }) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(
    registerAction,
    null,
  );
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const providerError = providerErrorMessage(searchParams.get('error'));

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{inviteToken ? 'Create your account' : 'Start your free trial'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {inviteToken
            ? 'Create an account to accept your invitation'
            : `Create your ${PLATFORM_NAME} account, then set up your shop. No card needed.`}
        </p>
      </div>

      {providerError && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {providerError}
        </p>
      )}

      {/* Google and Apple — the invite token travels so the account accepts it straight away.
          In the business app they run in the sign-in sheet (ROADMAP 19.2). */}
      <SignInProviders
        googleAction={googleSignInAction}
        appleAction={apple ? appleSignInAction : null}
        hidden={{ invite: inviteToken }}
        next={inviteToken ? `/invite/${encodeURIComponent(inviteToken)}?auto=1` : '/onboarding'}
      />

      {/* Divider */}
      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Registration form */}
      <form action={action} className="space-y-4">
        {/* Pass invite token through the form if present */}
        {inviteToken && (
          <input type="hidden" name="invite" value={inviteToken} />
        )}

        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="Ada Okafor"
            autoComplete="name"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="ada@yourshop.com"
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        {state?.error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {state.error}
          </p>
        )}

        <Button type="submit" className="w-full" size="sm" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href={inviteToken ? `/login?callbackUrl=/invite/${encodeURIComponent(inviteToken)}` : '/login'}
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
