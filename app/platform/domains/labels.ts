/* How domain work reads to platform staff (AGENTS §6: no raw enums). */
export const ORDER_KIND_LABEL: Record<'REGISTER' | 'EXISTING' | 'RENEW', string> = {
  REGISTER: 'Register',
  EXISTING: 'Connect',
  RENEW: 'Renew',
};

export const ORDER_STATUS: Record<string, { label: string; variant: 'pending' | 'success' | 'destructive' | 'cancelled' }> = {
  PENDING_FULFILLMENT: { label: 'Waiting', variant: 'pending' },
  ACTIVE: { label: 'Done', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'cancelled' },
};
