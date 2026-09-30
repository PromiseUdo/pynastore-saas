/* How a workspace's plan state and status read to platform staff (AGENTS §6: no raw enums). */
import type { AccessState } from '@/lib/billing/access';

export const PLAN_STATE_LABEL: Record<AccessState, string> = {
  active: 'Paying',
  trial: 'Free trial',
  grace: 'In grace',
  lapsed: 'Closed',
  none: 'No subscription',
};

export const PLAN_STATE_VARIANT: Record<AccessState, 'success' | 'info' | 'warning' | 'destructive' | 'muted'> = {
  active: 'success',
  trial: 'info',
  grace: 'warning',
  lapsed: 'destructive',
  none: 'muted',
};

export const PLAN_STATE_ORDER: AccessState[] = ['active', 'trial', 'grace', 'lapsed', 'none'];
