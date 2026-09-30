import { describe, expect, it } from 'vitest';
import {
  isReadyToSubmit,
  onlinePaymentReadiness,
  normalizeCacNumber,
  normalizeNigerianPhone,
  paymentSetupState,
  requiredDocuments,
  setupChecklist,
  type SetupDraft,
} from './payment-setup';

const complete: SetupDraft = {
  businessType: 'COMPANY',
  businessName: 'Ada Fabrics',
  cacNumber: 'RC1234567',
  registeredName: 'Ada Fabrics Limited',
  idType: 'NIN',
  settlementBankCode: '058',
  settlementAccountNumber: '0123456789',
  settlementAccountName: 'ADA FABRICS LTD',
  contactName: 'Ada Obi',
  contactEmail: 'ada@example.com',
  contactPhone: '+2348031234567',
  documents: [{ kind: 'CAC_CERTIFICATE' }, { kind: 'ID_DOCUMENT' }, { kind: 'PROOF_OF_ADDRESS' }],
};

describe('what each business must provide', () => {
  it('asks a registered business for CAC, ID and address, and an individual for ID and address', () => {
    expect(requiredDocuments('COMPANY')).toEqual(['CAC_CERTIFICATE', 'ID_DOCUMENT', 'PROOF_OF_ADDRESS']);
    expect(requiredDocuments('BUSINESS_NAME')).toEqual(['CAC_CERTIFICATE', 'ID_DOCUMENT', 'PROOF_OF_ADDRESS']);
    expect(requiredDocuments('INDIVIDUAL')).toEqual(['ID_DOCUMENT', 'PROOF_OF_ADDRESS']);
  });

  it('only lists a CAC step for a registered business', () => {
    expect(setupChecklist(complete).map((i) => i.key)).toContain('registration');
    expect(setupChecklist({ ...complete, businessType: 'INDIVIDUAL' }).map((i) => i.key)).not.toContain('registration');
  });

  it('is ready only when every step is done', () => {
    expect(isReadyToSubmit(complete)).toBe(true);
    expect(isReadyToSubmit({ ...complete, documents: complete.documents.filter((d) => d.kind !== 'PROOF_OF_ADDRESS') })).toBe(false);
    // An account number with no name Paystack resolved is not a settlement account.
    expect(isReadyToSubmit({ ...complete, settlementAccountName: null })).toBe(false);
    // An individual doesn't need CAC at all.
    expect(
      isReadyToSubmit({
        ...complete,
        businessType: 'INDIVIDUAL',
        cacNumber: null,
        registeredName: null,
        documents: [{ kind: 'ID_DOCUMENT' }, { kind: 'PROOF_OF_ADDRESS' }],
      }),
    ).toBe(true);
  });
});

describe('field rules', () => {
  it('reads CAC numbers however they are typed, and refuses the wrong prefix', () => {
    expect(normalizeCacNumber('rc 1234567', 'COMPANY')).toBe('RC1234567');
    expect(normalizeCacNumber('1234567', 'COMPANY')).toBe('RC1234567');
    expect(normalizeCacNumber('BN-3456789', 'BUSINESS_NAME')).toBe('BN3456789');
    expect(normalizeCacNumber('BN3456789', 'COMPANY')).toBeNull();
    expect(normalizeCacNumber('ABC', 'COMPANY')).toBeNull();
  });

  it('reads Nigerian mobile numbers in either form', () => {
    expect(normalizeNigerianPhone('0803 123 4567')).toBe('+2348031234567');
    expect(normalizeNigerianPhone('+234 803 123 4567')).toBe('+2348031234567');
    expect(normalizeNigerianPhone('12345')).toBeNull();
  });
});

describe('the state a merchant sees', () => {
  it('keeps our verification and Paystack’s setup apart', () => {
    expect(paymentSetupState(null).key).toBe('not_started');
    expect(paymentSetupState({ verificationStatus: 'UNVERIFIED', setupStatus: 'NOT_STARTED' }).key).toBe('in_progress');
    expect(paymentSetupState({ verificationStatus: 'PENDING', setupStatus: 'AWAITING_VERIFICATION' })).toMatchObject({
      key: 'in_review',
      editable: false,
    });
    // Approved by us is not "Ready" until the subaccount is active.
    expect(paymentSetupState({ verificationStatus: 'VERIFIED', setupStatus: 'CREATING' }).key).toBe('approved');
    expect(paymentSetupState({ verificationStatus: 'VERIFIED', setupStatus: 'ACTIVE' }).key).toBe('ready');
    expect(paymentSetupState({ verificationStatus: 'VERIFIED', setupStatus: 'ACTION_REQUIRED' }).key).toBe('attention');
  });

  it('tells a merchant why they were sent back, and lets them edit', () => {
    const state = paymentSetupState({
      verificationStatus: 'REJECTED',
      setupStatus: 'NOT_STARTED',
      rejectionReason: 'The ID photo is blurred.',
    });
    expect(state).toMatchObject({ key: 'needs_changes', editable: true });
    expect(state.hint).toContain('The ID photo is blurred.');
  });
});

describe('may this shop take online payments', () => {
  const active = 'ACTIVE';
  it('needs our approval AND an active subaccount AND an active business', () => {
    expect(onlinePaymentReadiness({ account: null, organizationStatus: active })).toEqual({ ready: false, blocker: 'not_submitted' });
    expect(onlinePaymentReadiness({ account: { verificationStatus: 'PENDING', setupStatus: 'AWAITING_VERIFICATION' }, organizationStatus: active }).blocker).toBe('in_review');
    expect(onlinePaymentReadiness({ account: { verificationStatus: 'REJECTED', setupStatus: 'NOT_STARTED' }, organizationStatus: active }).blocker).toBe('rejected');
    // Approved by us is not enough on its own.
    expect(onlinePaymentReadiness({ account: { verificationStatus: 'VERIFIED', setupStatus: 'AWAITING_VERIFICATION' }, organizationStatus: active }).blocker).toBe('payouts_not_ready');
    expect(onlinePaymentReadiness({ account: { verificationStatus: 'VERIFIED', setupStatus: 'ACTIVE' }, organizationStatus: active })).toEqual({ ready: true, blocker: null });
    // A suspended business takes nothing, whatever else is true.
    expect(onlinePaymentReadiness({ account: { verificationStatus: 'VERIFIED', setupStatus: 'ACTIVE' }, organizationStatus: 'SUSPENDED' }).blocker).toBe('suspended');
  });
});
