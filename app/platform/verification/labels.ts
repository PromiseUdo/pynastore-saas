/* How a verification status reads to platform staff (AGENTS §6: no raw enums). */
import type { SetupStatus, VerificationStatus } from '@/lib/payments/payment-setup';

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  UNVERIFIED: 'Not submitted',
  PENDING: 'Waiting for review',
  VERIFIED: 'Approved',
  REJECTED: 'Sent back',
};

export const VERIFICATION_VARIANT: Record<VerificationStatus, 'draft' | 'pending' | 'approved' | 'rejected'> = {
  UNVERIFIED: 'draft',
  PENDING: 'pending',
  VERIFIED: 'approved',
  REJECTED: 'rejected',
};

/* Where the Paystack subaccount stands (ROADMAP 10.3). */
export const SETUP_LABEL: Record<SetupStatus, string> = {
  NOT_STARTED: 'Not started',
  AWAITING_VERIFICATION: 'Waiting for approval',
  CREATING: 'Setting up',
  ACTIVE: 'Active',
  ACTION_REQUIRED: 'Needs attention',
  DISABLED: 'Switched off',
};

export const SETUP_VARIANT: Record<SetupStatus, 'draft' | 'pending' | 'processing' | 'success' | 'warning' | 'destructive'> = {
  NOT_STARTED: 'draft',
  AWAITING_VERIFICATION: 'pending',
  CREATING: 'processing',
  ACTIVE: 'success',
  ACTION_REQUIRED: 'warning',
  DISABLED: 'destructive',
};
