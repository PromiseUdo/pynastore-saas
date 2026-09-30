'use client';

/*
 * "Get paid online" — the merchant's side of ROADMAP 10.2.
 *
 * One page, in the order the details are asked for: the business, its CAC
 * registration (registered businesses only), proof of identity, proof of
 * address, the account online payments settle to, and a contact. The
 * checklist beside it is computed from what's on screen by the same rules the
 * server applies (lib/payments/payment-setup.ts), so it never claims a step is
 * done that the server would refuse.
 *
 * Under review or approved, the page is read-only; while it's under review the
 * merchant can take it back to change something.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Check, CircleCheck, Circle, Loader2, Lock, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Field, FieldDescription, FieldError, FormSection, FormGrid } from '@/components/ui/form-field';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { DocumentUploader, type UploadedDocument } from '@/components/media/document-uploader';
import { BankPicker } from '@/components/dashboard/bank-picker';
import {
  getVerificationDocumentUrl,
  getVerificationUploadSignature,
  lookupSettlementAccount,
  savePaymentSetup,
  withdrawPaymentSetup,
  type PaymentSetupFieldErrors,
  type PaymentSetupView,
} from '@/features/settings/payment-setup';
import type { PaystackBank } from '@/lib/payments/paystack';
import {
  BUSINESS_TYPES,
  DOCUMENTS,
  ID_TYPES,
  MAX_DOCUMENTS_PER_KIND,
  isRegistered,
  paymentSetupState,
  requiredDocuments,
  setupChecklist,
  type BusinessType,
  type DocumentKind,
  type IdType,
} from '@/lib/payments/payment-setup';
import { formatDate } from '@/lib/format';
import { PLATFORM_NAME } from '@/lib/brand';

type Lookup =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'found'; accountName: string }
  | { state: 'failed'; message: string };

type Docs = Record<DocumentKind, UploadedDocument[]>;

const DOC_KINDS: DocumentKind[] = ['CAC_CERTIFICATE', 'ID_DOCUMENT', 'PROOF_OF_ADDRESS'];

export function PaymentSetupForm({
  view,
  banks,
  banksError,
  canManage,
  testMode = false,
}: {
  view: PaymentSetupView;
  banks: PaystackBank[];
  banksError: string | null;
  canManage: boolean;
  /** the server's Paystack key is a test key — no real money moves */
  testMode?: boolean;
}) {
  const router = useRouter();
  const saved = view.account;
  const state = paymentSetupState(saved);
  const readOnly = !canManage || !state.editable;

  const [businessType, setBusinessType] = React.useState<BusinessType | null>(saved?.businessType ?? null);
  const [businessName, setBusinessName] = React.useState(saved?.businessName ?? view.prefill.businessName);
  const [cacNumber, setCacNumber] = React.useState(saved?.cacNumber ?? '');
  const [registeredName, setRegisteredName] = React.useState(saved?.registeredName ?? '');
  const [idType, setIdType] = React.useState<IdType | null>(saved?.idType ?? null);
  const [bankCode, setBankCode] = React.useState(saved?.settlementBankCode ?? '');
  const [accountNumber, setAccountNumber] = React.useState(saved?.settlementAccountNumber ?? '');
  const [contactName, setContactName] = React.useState(saved?.contactName ?? view.prefill.contactName);
  const [contactEmail, setContactEmail] = React.useState(saved?.contactEmail ?? view.prefill.contactEmail);
  const [contactPhone, setContactPhone] = React.useState(saved?.contactPhone ?? view.prefill.contactPhone);
  const [docs, setDocs] = React.useState<Docs>(() => {
    const byKind: Docs = { CAC_CERTIFICATE: [], ID_DOCUMENT: [], PROOF_OF_ADDRESS: [] };
    for (const d of saved?.documents ?? []) {
      byKind[d.kind].push({ publicId: d.publicId, format: d.format, bytes: d.bytes, fileName: d.fileName });
    }
    return byKind;
  });

  const [lookup, setLookup] = React.useState<Lookup>(() =>
    saved?.settlementAccountName ? { state: 'found', accountName: saved.settlementAccountName } : { state: 'idle' },
  );
  const [attempt, setAttempt] = React.useState(0);
  const [errors, setErrors] = React.useState<PaymentSetupFieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<'draft' | 'submit' | null>(null);
  const [uploading, setUploading] = React.useState<Record<DocumentKind, boolean>>({
    CAC_CERTIFICATE: false,
    ID_DOCUMENT: false,
    PROOF_OF_ADDRESS: false,
  });
  const [withdrawOpen, setWithdrawOpen] = React.useState(false);
  const [withdrawing, setWithdrawing] = React.useState(false);

  const registered = isRegistered(businessType);
  const needed = requiredDocuments(businessType);
  const digits = accountNumber.replace(/\s+/g, '');
  const ready = bankCode !== '' && /^\d{10}$/.test(digits);
  const busy = Object.values(uploading).some(Boolean);

  /* The account name is asked of Paystack as soon as there's a bank and ten
   * digits — unless it's the account already saved, whose name we have. */
  React.useEffect(() => {
    if (readOnly) return;
    if (!ready) {
      setLookup({ state: 'idle' });
      return;
    }
    if (
      attempt === 0 &&
      saved?.settlementAccountName &&
      bankCode === saved.settlementBankCode &&
      digits === saved.settlementAccountNumber
    ) {
      setLookup({ state: 'found', accountName: saved.settlementAccountName });
      return;
    }
    let cancelled = false;
    setLookup({ state: 'checking' });
    setErrors((prev) => ({ ...prev, settlementBankCode: undefined, settlementAccountNumber: undefined }));
    void lookupSettlementAccount({ bankCode, accountNumber: digits }).then((result) => {
      if (cancelled) return;
      if (result.success) setLookup({ state: 'found', accountName: result.data.accountName });
      else if ('fieldErrors' in result) {
        setErrors((prev) => ({ ...prev, ...result.fieldErrors }));
        setLookup({ state: 'idle' });
      } else setLookup({ state: 'failed', message: result.error });
    });
    return () => {
      cancelled = true;
    };
    // `saved` is the page's props: stable for this form's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, ready, bankCode, digits, attempt]);

  const checklist = setupChecklist({
    businessType,
    businessName,
    cacNumber,
    registeredName,
    idType,
    settlementBankCode: bankCode,
    settlementAccountNumber: digits,
    settlementAccountName: lookup.state === 'found' ? lookup.accountName : null,
    contactName,
    contactEmail,
    contactPhone,
    documents: needed.flatMap((kind) => docs[kind].map(() => ({ kind }))),
  });
  const doneCount = checklist.filter((i) => i.done).length;

  function setDocsFor(kind: DocumentKind, next: UploadedDocument[]) {
    setDocs((prev) => ({ ...prev, [kind]: next }));
    setErrors((prev) => ({ ...prev, [`documents.${kind}`]: undefined }));
  }

  const onBusy = React.useMemo(
    () =>
      Object.fromEntries(
        DOC_KINDS.map((kind) => [kind, (b: boolean) => setUploading((prev) => (prev[kind] === b ? prev : { ...prev, [kind]: b }))]),
      ) as Record<DocumentKind, (busy: boolean) => void>,
    [],
  );

  async function save(intent: 'draft' | 'submit') {
    setPending(intent);
    setFormError(null);
    setErrors({});
    const result = await savePaymentSetup(
      {
        businessType,
        businessName,
        cacNumber: registered ? cacNumber : '',
        registeredName: registered ? registeredName : '',
        idType,
        settlementBankCode: bankCode,
        settlementAccountNumber: digits,
        contactName,
        contactEmail,
        contactPhone,
        documents: needed.flatMap((kind) => docs[kind].map((d) => ({ ...d, kind }))),
      },
      intent,
    );
    setPending(null);
    if (!result.success) {
      if ('fieldErrors' in result) setErrors(result.fieldErrors);
      setFormError(result.error);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    toast.success(result.data.submitted ? 'Sent for review' : 'Saved — you can finish this later');
    router.refresh();
  }

  async function withdraw() {
    setWithdrawing(true);
    const result = await withdrawPaymentSetup();
    setWithdrawing(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setWithdrawOpen(false);
    toast.success('Taken back — you can change your details now');
    router.refresh();
  }

  const docProps = (kind: DocumentKind) => ({
    id: `doc-${kind}`,
    value: docs[kind],
    onChange: (next: UploadedDocument[]) => setDocsFor(kind, next),
    getSignature: getVerificationUploadSignature,
    onView: (doc: UploadedDocument) => getVerificationDocumentUrl({ publicId: doc.publicId, format: doc.format }),
    max: MAX_DOCUMENTS_PER_KIND,
    disabled: readOnly,
    invalid: Boolean(errors[`documents.${kind}`]),
    describedBy: `doc-${kind}-hint`,
    onBusyChange: onBusy[kind],
  });

  return (
    <div>
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link
          href="/settings/payments"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Payments
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Get paid online</h1>
          <Badge variant={state.variant}>{state.label}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.hint}
          {saved?.submittedAt && state.key === 'in_review' && ` Sent on ${formatDate(saved.submittedAt)}.`}
        </p>
        {state.key === 'in_review' && canManage && (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setWithdrawOpen(true)}>
            Take back to make changes
          </Button>
        )}
      </div>

      <div className="px-4 py-6 sm:px-6">
        {formError && (
          <p
            role="alert"
            className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        )}
        {!canManage && (
          <p className="mb-5 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            You can see these details, but only someone who can change settings can edit or submit them.
          </p>
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save('submit');
            }}
            className="min-w-0 space-y-10"
          >
            <FormSection
              title="Your business"
              description="Tell us how your business is set up. It decides which documents we ask for."
            >
              <RadioGroup
                value={businessType ?? ''}
                onValueChange={(v) => {
                  setBusinessType(v as BusinessType);
                  setErrors((prev) => ({ ...prev, businessType: undefined }));
                }}
                disabled={readOnly}
                aria-label="Kind of business"
                aria-invalid={errors.businessType ? true : undefined}
              >
                {BUSINESS_TYPES.map((option) => (
                  <RadioGroupCard key={option.value} value={option.value} id={`type-${option.value}`} className="p-3" disabled={readOnly}>
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
                  </RadioGroupCard>
                ))}
              </RadioGroup>
              {errors.businessType && <FieldError>{errors.businessType}</FieldError>}

              <Field>
                <Label htmlFor="business-name">Business name *</Label>
                <Input
                  id="business-name"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  disabled={readOnly}
                  maxLength={120}
                  aria-invalid={errors.businessName ? true : undefined}
                />
                {errors.businessName ? (
                  <FieldError>{errors.businessName}</FieldError>
                ) : (
                  <FieldDescription>The name your customers know you by.</FieldDescription>
                )}
              </Field>
            </FormSection>

            {registered && (
              <FormSection
                title="CAC registration"
                description="As it appears on your certificate from the Corporate Affairs Commission."
              >
                <FormGrid>
                  <Field>
                    <Label htmlFor="cac-number">{businessType === 'BUSINESS_NAME' ? 'BN number' : 'RC number'} *</Label>
                    <Input
                      id="cac-number"
                      value={cacNumber}
                      onChange={(e) => setCacNumber(e.target.value)}
                      disabled={readOnly}
                      placeholder={businessType === 'BUSINESS_NAME' ? 'BN 1234567' : 'RC 1234567'}
                      autoComplete="off"
                      aria-invalid={errors.cacNumber ? true : undefined}
                    />
                    {errors.cacNumber && <FieldError>{errors.cacNumber}</FieldError>}
                  </Field>
                  <Field>
                    <Label htmlFor="registered-name">Registered name *</Label>
                    <Input
                      id="registered-name"
                      value={registeredName}
                      onChange={(e) => setRegisteredName(e.target.value)}
                      disabled={readOnly}
                      maxLength={160}
                      aria-invalid={errors.registeredName ? true : undefined}
                    />
                    {errors.registeredName ? (
                      <FieldError>{errors.registeredName}</FieldError>
                    ) : (
                      <FieldDescription>Exactly as printed on the certificate.</FieldDescription>
                    )}
                  </Field>
                </FormGrid>
                <DocumentField kind="CAC_CERTIFICATE" error={errors['documents.CAC_CERTIFICATE']}>
                  <DocumentUploader {...docProps('CAC_CERTIFICATE')} />
                </DocumentField>
              </FormSection>
            )}

            <FormSection
              title="Proof of identity"
              description={
                registered
                  ? 'An ID for a director or the owner of the business.'
                  : 'Your own ID — the person the business belongs to.'
              }
            >
              <Field className="sm:max-w-sm">
                <Label htmlFor="id-type">Type of ID *</Label>
                <SelectRoot
                  value={idType ?? ''}
                  onValueChange={(v) => {
                    setIdType(v as IdType);
                    setErrors((prev) => ({ ...prev, idType: undefined }));
                  }}
                  disabled={readOnly}
                >
                  <SelectTrigger id="id-type" aria-invalid={errors.idType ? true : undefined}>
                    <SelectValue placeholder="Choose an ID" />
                  </SelectTrigger>
                  <SelectContent>
                    {ID_TYPES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
                {errors.idType && <FieldError>{errors.idType}</FieldError>}
              </Field>
              <DocumentField kind="ID_DOCUMENT" error={errors['documents.ID_DOCUMENT']}>
                <DocumentUploader {...docProps('ID_DOCUMENT')} />
              </DocumentField>
            </FormSection>

            <FormSection title="Proof of address">
              <DocumentField kind="PROOF_OF_ADDRESS" error={errors['documents.PROOF_OF_ADDRESS']}>
                <DocumentUploader {...docProps('PROOF_OF_ADDRESS')} />
              </DocumentField>
            </FormSection>

            <FormSection
              title="Account to be paid into"
              description={`Online payments settle into this account through Paystack, less Paystack’s fee. ${PLATFORM_NAME} doesn’t hold your money or take a cut of your sales.`}
            >
              <FormGrid>
                <Field>
                  <Label htmlFor="settlement-bank">Bank *</Label>
                  <BankPicker
                    banks={banks}
                    value={bankCode}
                    onChange={(code) => {
                      setBankCode(code);
                      setErrors((prev) => ({ ...prev, settlementBankCode: undefined }));
                    }}
                    disabled={readOnly || banksError !== null}
                    invalid={Boolean(errors.settlementBankCode)}
                    savedName={saved?.settlementBankName ?? null}
                  />
                  {banksError ? (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      <span>{banksError}</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
                        <RotateCw className="size-3.5" /> Try again
                      </Button>
                    </div>
                  ) : errors.settlementBankCode ? (
                    <FieldError>{errors.settlementBankCode}</FieldError>
                  ) : (
                    testMode &&
                    !readOnly && (
                      <FieldDescription>
                        Test mode: Paystack checks only 3 real accounts a day. Use Zenith Bank with account 0000000000.
                      </FieldDescription>
                    )
                  )}
                </Field>
                <Field>
                  <Label htmlFor="settlement-account">Account number *</Label>
                  <Input
                    id="settlement-account"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0123456789"
                    maxLength={12}
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    disabled={readOnly}
                    aria-invalid={errors.settlementAccountNumber ? true : undefined}
                    aria-describedby="settlement-lookup"
                  />
                  {errors.settlementAccountNumber ? (
                    <FieldError>{errors.settlementAccountNumber}</FieldError>
                  ) : (
                    <FieldDescription>10 digits. We’ll look up the name on it.</FieldDescription>
                  )}
                </Field>
              </FormGrid>

              <div id="settlement-lookup" aria-live="polite">
                {lookup.state === 'checking' && (
                  <p className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Checking with your bank…
                  </p>
                )}
                {lookup.state === 'found' && (
                  <div className="flex items-start gap-2.5 rounded-md border bg-muted/40 px-3 py-2.5">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Account name</p>
                      <p className="text-sm font-medium text-foreground">{lookup.accountName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        It should be in your business’s name or your own. If it isn’t, check the number.
                      </p>
                    </div>
                  </div>
                )}
                {lookup.state === 'failed' && (
                  <div
                    role="alert"
                    className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    <span>{lookup.message}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                      <RotateCw className="size-3.5" />
                      Try again
                    </Button>
                  </div>
                )}
              </div>
            </FormSection>

            <FormSection
              title="Contact for payments"
              description="Who we get in touch with about your payouts or these details."
            >
              <FormGrid>
                <Field>
                  <Label htmlFor="contact-name">Name *</Label>
                  <Input
                    id="contact-name"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    disabled={readOnly}
                    autoComplete="name"
                    aria-invalid={errors.contactName ? true : undefined}
                  />
                  {errors.contactName && <FieldError>{errors.contactName}</FieldError>}
                </Field>
                <Field>
                  <Label htmlFor="contact-phone">Phone *</Label>
                  <Input
                    id="contact-phone"
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    disabled={readOnly}
                    autoComplete="tel"
                    placeholder="0803 123 4567"
                    aria-invalid={errors.contactPhone ? true : undefined}
                  />
                  {errors.contactPhone && <FieldError>{errors.contactPhone}</FieldError>}
                </Field>
                <Field className="sm:col-span-2">
                  <Label htmlFor="contact-email">Email *</Label>
                  <Input
                    id="contact-email"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    disabled={readOnly}
                    autoComplete="email"
                    aria-invalid={errors.contactEmail ? true : undefined}
                  />
                  {errors.contactEmail && <FieldError>{errors.contactEmail}</FieldError>}
                </Field>
              </FormGrid>
            </FormSection>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Your documents are stored privately. Only people who can change settings in this business, and the team
              checking your details, can open them.
            </p>

            {!readOnly && (
              <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void save('draft')}
                    disabled={pending !== null || busy}
                  >
                    {pending === 'draft' && <Loader2 className="size-3.5 animate-spin" />}
                    Save and finish later
                  </Button>
                  <Button type="submit" size="sm" disabled={pending !== null || busy}>
                    {pending === 'submit' && <Loader2 className="size-3.5 animate-spin" />}
                    Submit for review
                  </Button>
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  {busy
                    ? 'Wait for your uploads to finish.'
                    : 'Submitting sends your details to our team to check. You can’t change them while they’re being checked.'}
                </p>
              </div>
            )}
          </form>

          <aside className="order-first lg:order-none">
            <div className="rounded-lg border bg-card p-4 lg:sticky lg:top-4">
              <h2 className="text-sm font-semibold">
                What’s needed <span className="font-normal text-muted-foreground tabular-nums">· {doneCount} of {checklist.length}</span>
              </h2>
              <ul className="mt-3 space-y-2">
                {checklist.map((item) => (
                  <li key={item.key} className="flex items-center gap-2 text-sm">
                    {item.done ? (
                      <Check className="size-4 shrink-0 text-success" aria-hidden />
                    ) : (
                      <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className={item.done ? 'text-foreground' : 'text-muted-foreground'}>{item.label}</span>
                    <span className="sr-only">{item.done ? '— done' : '— still needed'}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Once we’ve checked your details, we set up your payouts with Paystack. You’ll never need a Paystack
                account or key of your own.
              </p>
            </div>
          </aside>
        </div>
      </div>

      <AlertDialogRoot open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take your details back?</AlertDialogTitle>
            <AlertDialogDescription>
              Our team will stop checking them until you submit again, and your place in the queue is lost. Nothing you
              entered is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Leave them with the team</AlertDialogCancel>
            <Button onClick={withdraw} disabled={withdrawing}>
              {withdrawing && <Loader2 className="size-3.5 animate-spin" />}
              Take back to edit
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}

function DocumentField({ kind, error, children }: { kind: DocumentKind; error?: string; children: React.ReactNode }) {
  return (
    <Field>
      <Label htmlFor={`doc-${kind}`}>{DOCUMENTS[kind].label} *</Label>
      <FieldDescription id={`doc-${kind}-hint`}>
        {DOCUMENTS[kind].hint} PDF, JPG, PNG or WebP, up to 10 MB.
      </FieldDescription>
      {children}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}
