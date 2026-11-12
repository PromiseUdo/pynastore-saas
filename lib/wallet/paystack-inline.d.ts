/* The parts of @paystack/inline-js (no bundled types) that wallet top-ups use. */
declare module '@paystack/inline-js' {
  export default class PaystackPop {
    resumeTransaction(
      accessCode: string,
      callbacks?: {
        onSuccess?: (transaction: { id: number; reference: string; message: string }) => void;
        onCancel?: () => void;
        onError?: (error: { message: string }) => void;
        onLoad?: (transaction: { id: number; accessCode: string }) => void;
      },
    ): unknown;
  }
}
