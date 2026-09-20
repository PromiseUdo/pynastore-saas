'use client';

import { Suspense, useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resetPasswordAction, type ResetPasswordState } from './actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(
    resetPasswordAction,
    null,
  );
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  if (!token) {
    return (
      <div className="p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold tracking-tight">Invalid link</h1>
        <p className="text-sm text-muted-foreground">
          This password reset link is missing or malformed. Please request a
          new one.
        </p>
        <Button asChild className="mt-6 w-full" size="sm">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  if (state && 'success' in state) {
    return (
      <div className="p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold tracking-tight">
          Password reset
        </h1>
        <p className="text-sm text-muted-foreground">
          Your password has been updated. You can now sign in with your new
          password.
        </p>
        <Button asChild className="mt-6 w-full" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Reset password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a new password for your account.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="text-xs text-muted-foreground">
            Must be at least 8 characters long.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            placeholder="Re-enter your password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        {state && 'error' in state && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {state.error}
          </p>
        )}

        <Button type="submit" className="w-full" size="sm" disabled={pending}>
          {pending ? 'Resetting…' : 'Reset password'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link
          href="/login"
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
