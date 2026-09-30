/*
 * lib/payments/payment-setup.ts
 *
 * The rules for "Get paid online" (ROADMAP 10.2): what each kind of business
 * must give us, how each field is checked, and what state a shop's setup is
 * in. Pure and client-safe — the form, the Settings → Payments card and the
 * server actions all read it, so they can't disagree about what's missing.
 *
 * Two lists are kept apart on purpose (10.2):
 *   - what PAYSTACK needs for a subaccount — business name, settlement bank,
 *     account number (its dashboard asks for nothing more);
 *   - what OUR verification needs — CAC details, an ID and proof of address.
 * Nothing here is ever a Paystack key; merchants are never asked for one.
 */

export type BusinessType = 'COMPANY' | 'BUSINESS_NAME' | 'INDIVIDUAL';
export type IdType = 'NIN' | 'INTERNATIONAL_PASSPORT' | 'DRIVERS_LICENCE' | 'VOTERS_CARD';
export type DocumentKind = 'CAC_CERTIFICATE' | 'ID_DOCUMENT' | 'PROOF_OF_ADDRESS';
export type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
export type SetupStatus =
  | 'NOT_STARTED'
  | 'AWAITING_VERIFICATION'
  | 'CREATING'
  | 'ACTIVE'
  | 'ACTION_REQUIRED'
  | 'DISABLED';

export const BUSINESS_TYPES: { value: BusinessType; label: string; hint: string }[] = [
  {
    value: 'COMPANY',
    label: 'Registered company',
    hint: 'Registered with CAC as a limited company — you have an RC number.',
  },
  {
    value: 'BUSINESS_NAME',
    label: 'Registered business name',
    hint: 'Registered with CAC as a business name — you have a BN number.',
  },
  {
    value: 'INDIVIDUAL',
    label: 'Individual or sole trader',
    hint: 'Trading in your own name, without CAC registration.',
  },
];

export const ID_TYPES: { value: IdType; label: string }[] = [
  { value: 'NIN', label: 'National ID (NIN slip or card)' },
  { value: 'INTERNATIONAL_PASSPORT', label: 'International passport' },
  { value: 'DRIVERS_LICENCE', label: 'Driver’s licence' },
  { value: 'VOTERS_CARD', label: 'Voter’s card' },
];

export const DOCUMENTS: Record<DocumentKind, { label: string; hint: string }> = {
  CAC_CERTIFICATE: {
    label: 'CAC certificate',
    hint: 'Your certificate of incorporation or business name registration.',
  },
  ID_DOCUMENT: {
    label: 'ID document',
    hint: 'A clear photo or scan of the ID you chose, showing your name and photo. Add the back as well if it has one.',
  },
  PROOF_OF_ADDRESS: {
    label: 'Proof of address',
    hint: 'A recent utility bill or bank statement showing your business or home address.',
  },
};

/** Files per kind — an ID can have a front and a back. */
export const MAX_DOCUMENTS_PER_KIND = 3;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_FORMATS = ['pdf', 'jpg', 'jpeg', 'png', 'webp'] as const;

export function isRegistered(type: BusinessType | null | undefined): boolean {
  return type === 'COMPANY' || type === 'BUSINESS_NAME';
}

export function requiredDocuments(type: BusinessType | null | undefined): DocumentKind[] {
  return isRegistered(type)
    ? ['CAC_CERTIFICATE', 'ID_DOCUMENT', 'PROOF_OF_ADDRESS']
    : ['ID_DOCUMENT', 'PROOF_OF_ADDRESS'];
}

/**
 * "rc 1234567", "RC-1234567" and "1234567" all become "RC1234567" for a
 * company; "BN" for a business name. Returns null when it isn't a CAC number.
 */
export function normalizeCacNumber(raw: string, type: BusinessType | null | undefined): string | null {
  const compact = raw.replace(/[\s\-.]/g, '').toUpperCase();
  const match = /^(RC|BN)?(\d{4,9})$/.exec(compact);
  if (!match) return null;
  const expected = type === 'BUSINESS_NAME' ? 'BN' : 'RC';
  if (match[1] && match[1] !== expected) return null;
  return `${expected}${match[2]}`;
}

/** Nigerian mobile numbers, as +234XXXXXXXXXX. Null when it isn't one. */
export function normalizeNigerianPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '');
  const match = /^(?:\+?234|0)([789][01]\d{8})$/.exec(digits);
  return match ? `+234${match[1]}` : null;
}

export function isAccountNumber(value: string): boolean {
  return /^\d{10}$/.test(value.replace(/\s+/g, ''));
}

export function maskAccountNumber(value: string | null | undefined): string {
  if (!value) return '—';
  return `••••${value.slice(-4)}`;
}

/* ---------------- what's missing ---------------- */

export interface SetupDocument {
  kind: DocumentKind;
}

export interface SetupDraft {
  businessType: BusinessType | null;
  businessName: string | null;
  cacNumber: string | null;
  registeredName: string | null;
  idType: IdType | null;
  settlementBankCode: string | null;
  settlementAccountNumber: string | null;
  settlementAccountName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  documents: SetupDocument[];
}

export type ChecklistKey = 'business' | 'registration' | 'identity' | 'address' | 'settlement' | 'contact';

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  done: boolean;
}

const filled = (value: string | null | undefined) => Boolean(value && value.trim());
const hasDoc = (draft: SetupDraft, kind: DocumentKind) => draft.documents.some((d) => d.kind === kind);

/**
 * The steps, in the order the form asks for them. Registration only appears
 * for a registered business — an individual has nothing to register.
 */
export function setupChecklist(draft: SetupDraft): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { key: 'business', label: 'Your business', done: Boolean(draft.businessType) && filled(draft.businessName) },
  ];
  if (isRegistered(draft.businessType)) {
    items.push({
      key: 'registration',
      label: 'CAC registration',
      done: filled(draft.cacNumber) && filled(draft.registeredName) && hasDoc(draft, 'CAC_CERTIFICATE'),
    });
  }
  items.push(
    { key: 'identity', label: 'Proof of identity', done: Boolean(draft.idType) && hasDoc(draft, 'ID_DOCUMENT') },
    { key: 'address', label: 'Proof of address', done: hasDoc(draft, 'PROOF_OF_ADDRESS') },
    {
      key: 'settlement',
      label: 'Account to be paid into',
      done: filled(draft.settlementBankCode) && filled(draft.settlementAccountNumber) && filled(draft.settlementAccountName),
    },
    {
      key: 'contact',
      label: 'Contact for payments',
      done: filled(draft.contactName) && filled(draft.contactEmail) && filled(draft.contactPhone),
    },
  );
  return items;
}

export function isReadyToSubmit(draft: SetupDraft): boolean {
  return setupChecklist(draft).every((item) => item.done);
}

/* ---------------- the state a merchant sees ---------------- */

export type SetupStateKey = 'not_started' | 'in_progress' | 'in_review' | 'needs_changes' | 'approved' | 'ready' | 'attention';

export interface SetupState {
  key: SetupStateKey;
  label: string;
  variant: 'draft' | 'pending' | 'rejected' | 'approved' | 'success' | 'warning';
  /** one plain sentence: where this is and what happens next */
  hint: string;
  /** the merchant may change what they sent */
  editable: boolean;
}

/**
 * Our verification and Paystack's subaccount are separate facts (10.8):
 * VERIFIED never means Paystack is ready, so "Ready" needs both.
 */
export function paymentSetupState(
  account: { verificationStatus: VerificationStatus; setupStatus: SetupStatus; rejectionReason?: string | null } | null,
): SetupState {
  if (!account) {
    return {
      key: 'not_started',
      label: 'Not set up',
      variant: 'draft',
      hint: 'Tell us about your business and where to send your money, and we’ll check the details.',
      editable: true,
    };
  }
  switch (account.verificationStatus) {
    case 'UNVERIFIED':
      return {
        key: 'in_progress',
        label: 'Not submitted',
        variant: 'draft',
        hint: 'Your details are saved. Finish the remaining steps and submit them for review.',
        editable: true,
      };
    case 'PENDING':
      return {
        key: 'in_review',
        label: 'Checking your details',
        variant: 'pending',
        hint: 'Our team is checking your business details. We’ll show the result here.',
        editable: false,
      };
    case 'REJECTED':
      return {
        key: 'needs_changes',
        label: 'Needs changes',
        variant: 'rejected',
        hint: account.rejectionReason?.trim()
          ? `We couldn’t approve your details: ${account.rejectionReason.trim()}`
          : 'We couldn’t approve your details. Check them and submit again.',
        editable: true,
      };
    case 'VERIFIED':
      if (account.setupStatus === 'ACTIVE') {
        return {
          key: 'ready',
          label: 'Ready',
          variant: 'success',
          hint: 'Online payments settle straight to your bank account, less Paystack’s fee.',
          editable: false,
        };
      }
      if (account.setupStatus === 'ACTION_REQUIRED' || account.setupStatus === 'DISABLED') {
        return {
          key: 'attention',
          label: 'Needs attention',
          variant: 'warning',
          hint: 'Your business is approved, but we couldn’t finish setting up payouts yet. We’re looking into it.',
          editable: false,
        };
      }
      return {
        key: 'approved',
        label: 'Approved',
        variant: 'approved',
        hint: 'Your business is approved. We’re setting up payouts to your bank account.',
        editable: false,
      };
  }
}

/* ---------------- may this shop take online payments? ---------------- */

export type OnlinePaymentBlocker = 'not_submitted' | 'in_review' | 'rejected' | 'payouts_not_ready' | 'suspended';

/**
 * The one rule (ROADMAP 10.8): online payment is offered only when OUR
 * verification is VERIFIED, the Paystack subaccount is ACTIVE, and the
 * business isn't suspended. Anything else names the first thing in the way.
 *
 * Checkout will read this when it moves to Paystack (10.4); until then the
 * dashboard uses it to say what's missing.
 */
export function onlinePaymentReadiness(input: {
  account: { verificationStatus: VerificationStatus; setupStatus: SetupStatus } | null;
  organizationStatus: string;
}): { ready: boolean; blocker: OnlinePaymentBlocker | null } {
  const { account, organizationStatus } = input;
  let blocker: OnlinePaymentBlocker | null = null;
  if (organizationStatus !== 'ACTIVE') blocker = 'suspended';
  else if (!account || account.verificationStatus === 'UNVERIFIED') blocker = 'not_submitted';
  else if (account.verificationStatus === 'PENDING') blocker = 'in_review';
  else if (account.verificationStatus === 'REJECTED') blocker = 'rejected';
  else if (account.setupStatus !== 'ACTIVE') blocker = 'payouts_not_ready';
  return { ready: blocker === null, blocker };
}
