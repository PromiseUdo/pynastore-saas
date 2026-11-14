import { FileQuestion } from 'lucide-react';

/**
 * One answer for a wrong token and an order that has no business invoice. Saying which
 * would tell whoever is guessing that they are getting warm.
 */
export default function TradeInvoiceNotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <FileQuestion className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="mt-4 text-lg font-semibold">We can’t find that invoice</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Check the link in your order email, or open the order from your account. If you
        still can’t find it, get in touch with the store.
      </p>
    </div>
  );
}
