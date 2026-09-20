'use client';

import { useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="sm" disabled={pending}>
      {pending ? 'Accepting…' : 'Accept invitation'}
    </Button>
  );
}

export function AcceptForm({
  action,
  errorMessage,
  autoSubmit = false,
}: {
  action: () => Promise<void>;
  errorMessage?: string;
  autoSubmit?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  // When coming from the registration flow (?auto=1), submit the form
  // programmatically so the server action fires in proper POST context.
  // Direct server-component calls to acceptInvitation can't set cookies
  // (unstable_update requires a server-action context), so we must go
  // through the form action path.
  useEffect(() => {
    if (autoSubmit) {
      formRef.current?.requestSubmit();
    }
  }, [autoSubmit]);

  return (
    <form ref={formRef} action={action}>
      {errorMessage && (
        <p role="alert" className="mb-4 text-xs font-medium text-destructive">
          {errorMessage}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
