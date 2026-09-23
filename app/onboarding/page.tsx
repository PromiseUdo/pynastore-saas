'use client';

import { useActionState, useState } from 'react';
import { createOrganizationAction, type OnboardingState } from './actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PLATFORM_NAME } from '@/lib/brand';

function toSlugPreview(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 48);
}

export default function OnboardingPage() {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    createOrganizationAction,
    null,
  );
  const [name, setName] = useState('');
  const slugPreview = toSlugPreview(name);
  const isSubmitDisabled = pending || !name.trim();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-12">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          S
        </div>
        <span className="text-base font-semibold text-foreground">
          {PLATFORM_NAME}
        </span>
      </div>

      {/* Card */}
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Create your organization
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This is your company&apos;s workspace. You can invite teammates
            after setup.
          </p>
        </div>

        <form action={action} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="name">Organization name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              placeholder="Acme Manufacturing Ltd"
              autoComplete="organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            {slugPreview && (
              <p className="text-[11px] text-muted-foreground">
                Your URL:{' '}
                <span className="font-mono text-foreground">
                  app.safebase.com/{slugPreview}
                </span>
              </p>
            )}
          </div>

          {state?.error && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {state.error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            size="sm"
            disabled={isSubmitDisabled}
          >
            {pending ? 'Creating workspace…' : 'Create workspace'}
          </Button>
        </form>
      </div>
    </div>
  );
}
