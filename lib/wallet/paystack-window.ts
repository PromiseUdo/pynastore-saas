'use client';

/*
 * lib/wallet/paystack-window.ts
 *
 * Opens Paystack's payment window ON the current page for a wallet top-up
 * (ROADMAP 20.3) — never a redirect. The access code came from EduPay via
 * our server; Paystack's own frame takes the card, so nothing typed there
 * reaches us. The answer is only a hint: the server still asks EduPay
 * whether the money landed before anyone is told it did.
 *
 * Loaded on demand, so pages that never top up never download it.
 */
export type PaystackWindowResult = 'paid' | 'closed' | 'error';

export async function openPaystackWindow(accessCode: string): Promise<PaystackWindowResult> {
  const { default: PaystackPop } = await import('@paystack/inline-js');
  return new Promise((resolve) => {
    new PaystackPop().resumeTransaction(accessCode, {
      onSuccess: () => resolve('paid'),
      onCancel: () => resolve('closed'),
      onError: () => resolve('error'),
    });
  });
}
