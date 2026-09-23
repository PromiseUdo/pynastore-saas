import { FileQuestion } from 'lucide-react';

/**
 * One answer for a wrong token, a voided invoice and a draft. Saying which
 * would tell whoever is guessing that they are getting warm.
 */
export default function InvoiceNotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <FileQuestion className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="mt-4 text-lg font-semibold">We can’t find that invoice</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The link may have expired, or the invoice may have been cancelled. Check the most recent email you
        were sent, or get in touch with the business that billed you.
      </p>
    </div>
  );
}
