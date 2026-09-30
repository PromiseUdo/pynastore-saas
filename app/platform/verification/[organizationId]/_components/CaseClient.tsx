'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Check, ExternalLink, FileText, Loader2, RefreshCw, RotateCw, TriangleAlert, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldDescription, FieldError } from '@/components/ui/form-field';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { auditActionLabel } from '@/lib/audit-labels';
import { BUSINESS_TYPES, DOCUMENTS, ID_TYPES, requiredDocuments } from '@/lib/payments/payment-setup';
import {
  approveVerification,
  checkSubaccount,
  getCaseDocumentUrl,
  rejectVerification,
  retrySubaccount,
  type VerificationCase,
} from '@/features/platform/verification';
import { SETUP_LABEL, SETUP_VARIANT, VERIFICATION_LABEL, VERIFICATION_VARIANT } from '../../labels';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CaseClient({ data }: { data: VerificationCase }) {
  const router = useRouter();
  const { organization, account, documents, history } = data;
  const pending = account.verificationStatus === 'PENDING';
  const now = new Date();

  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [reasonError, setReasonError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'approve' | 'reject' | 'retry' | 'check' | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const needed = requiredDocuments(account.businessType);
  const missingDocs = needed.filter((kind) => !documents.some((d) => d.kind === kind));

  async function approve() {
    setBusy('approve');
    const result = await approveVerification(organization.id);
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setApproveOpen(false);
    if (result.data.payouts === 'created' || result.data.payouts === 'adopted') {
      toast.success('Approved, and payouts are set up — the merchant has been emailed');
    } else {
      toast.warning('Approved, but payouts couldn’t be set up yet — see Payouts below');
    }
    router.refresh();
  }

  async function retry() {
    setBusy('retry');
    const result = await retrySubaccount(organization.id);
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
    } else {
      toast.success(result.data.outcome === 'adopted' ? 'Found the existing payout account and linked it' : 'Payouts are set up');
    }
    router.refresh();
  }

  async function check() {
    setBusy('check');
    const result = await checkSubaccount(organization.id);
    setBusy(null);
    if (!result.success) toast.error(result.error);
    else toast.success('Checked with Paystack');
    router.refresh();
  }

  async function reject() {
    setBusy('reject');
    setReasonError(null);
    const result = await rejectVerification(organization.id, reason);
    setBusy(null);
    if (!result.success) {
      if ('fieldError' in result) setReasonError(result.fieldError);
      else toast.error(result.error);
      return;
    }
    setRejectOpen(false);
    toast.success('Sent back — the merchant has been emailed');
    router.refresh();
  }

  async function view(documentId: string) {
    setOpening(documentId);
    setNotice(null);
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    const result = await getCaseDocumentUrl(organization.id, documentId);
    setOpening(null);
    if (result.success) {
      if (tab) tab.location.href = result.data.url;
      else setNotice('Your browser blocked the new tab. Allow pop-ups for this site to view documents.');
    } else {
      tab?.close();
      setNotice(result.error);
    }
  }

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: 'Business type', value: BUSINESS_TYPES.find((t) => t.value === account.businessType)?.label ?? '—' },
    { label: 'Business name', value: account.businessName ?? '—' },
    ...(account.businessType === 'COMPANY' || account.businessType === 'BUSINESS_NAME'
      ? [
          { label: 'CAC number', value: account.cacNumber ?? '—' },
          { label: 'Registered name', value: account.registeredName ?? '—' },
        ]
      : []),
    { label: 'ID type', value: ID_TYPES.find((t) => t.value === account.idType)?.label ?? '—' },
  ];

  return (
    <div>
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link
          href="/platform/verification"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Verification
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {account.businessName ?? organization.name}
            </h1>
            <Badge variant={VERIFICATION_VARIANT[account.verificationStatus]}>
              {VERIFICATION_LABEL[account.verificationStatus]}
            </Badge>
          </div>
          {pending && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)}>
                <Undo2 className="size-3.5" />
                Send back
              </Button>
              <Button size="sm" onClick={() => setApproveOpen(true)}>
                <Check className="size-3.5" />
                Approve
              </Button>
            </div>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {pending && account.submittedAt
            ? `Waiting since ${formatDate(account.submittedAt)} — compare the documents with the details, and the account name with the business or its owner.`
            : account.verificationStatus === 'VERIFIED'
              ? `Approved${account.reviewedBy ? ` by ${account.reviewedBy}` : ''}${account.reviewedAt ? ` on ${formatDate(account.reviewedAt)}` : ''}.`
              : account.verificationStatus === 'REJECTED'
                ? `Sent back${account.reviewedBy ? ` by ${account.reviewedBy}` : ''}${account.reviewedAt ? ` on ${formatDate(account.reviewedAt)}` : ''} — waiting for the merchant to resubmit.`
                : 'The merchant hasn’t submitted these details yet, so there’s nothing to decide.'}
        </p>
        {account.verificationStatus === 'REJECTED' && account.rejectionReason && (
          <p className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground">
            <span className="text-xs text-muted-foreground">Reason given: </span>
            {account.rejectionReason}
          </p>
        )}
      </div>

      <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">The business</h2>
            <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                  <dd className="text-foreground">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Documents</h2>
            {missingDocs.length > 0 && (
              <p className="flex items-center gap-2 border-b bg-destructive/5 px-4 py-2 text-sm text-destructive">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                Missing: {missingDocs.map((kind) => DOCUMENTS[kind].label).join(', ')}
              </p>
            )}
            {documents.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No documents uploaded.</p>
            ) : (
              <ul className="divide-y">
                {documents.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-3 px-4 py-2.5">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{DOCUMENTS[doc.kind].label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {doc.fileName} · {doc.format.toUpperCase()} · {formatBytes(doc.bytes)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void view(doc.id)}
                      disabled={opening === doc.id}
                      aria-label={`Open ${DOCUMENTS[doc.kind].label}: ${doc.fileName}`}
                    >
                      {opening === doc.id ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                      Open
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {notice && (
              <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">
                {notice}
              </p>
            )}
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Each link works for five minutes. Don’t download or forward these files.
            </p>
          </section>

          <section className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Account to be paid into</h2>
            <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Bank</dt>
                <dd className="text-foreground">{account.settlementBankName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Account number</dt>
                <dd className="tabular-nums text-foreground">{account.settlementAccountNumber ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Name the bank holds</dt>
                <dd className="font-medium text-foreground">{account.settlementAccountName ?? '—'}</dd>
              </div>
            </dl>
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              The name comes from Paystack, not the merchant. It should match the business or the person on the ID.
            </p>
          </section>
        </div>

        <aside className="space-y-6">
          {account.verificationStatus === 'VERIFIED' && (
            <section className="rounded-lg border bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Payouts</h2>
                <Badge variant={SETUP_VARIANT[account.setupStatus]}>{SETUP_LABEL[account.setupStatus]}</Badge>
              </div>
              <dl className="space-y-3 p-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Paystack subaccount</dt>
                  <dd className="font-mono text-xs text-foreground">{account.paystackSubaccountCode ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Paystack “verified”</dt>
                  <dd className="text-foreground">
                    {account.paystackIsVerified === null ? '—' : account.paystackIsVerified ? 'Yes' : 'No'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Last checked with Paystack</dt>
                  <dd className="text-foreground">
                    {account.paystackSyncedAt ? (
                      <span title={formatDate(account.paystackSyncedAt)}>{formatRelativeTime(account.paystackSyncedAt, now)}</span>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
              </dl>
              {account.setupError && (
                <p className="flex items-start gap-2 border-t bg-destructive/5 px-4 py-2 text-xs text-destructive">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {account.setupError}
                </p>
              )}
              <div className="flex flex-wrap gap-2 border-t px-4 py-3">
                {!account.paystackSubaccountCode &&
                  (account.setupStatus === 'ACTION_REQUIRED' ||
                    account.setupStatus === 'AWAITING_VERIFICATION' ||
                    account.setupStatus === 'CREATING') && (
                    <Button size="sm" onClick={retry} disabled={busy !== null}>
                      {busy === 'retry' ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                      Try again
                    </Button>
                  )}
                {account.paystackSubaccountCode && (
                  <Button variant="outline" size="sm" onClick={check} disabled={busy !== null}>
                    {busy === 'check' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    Check with Paystack
                  </Button>
                )}
              </div>
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                Online payments settle to the merchant’s account through this subaccount. The platform’s share is zero
                and the merchant pays Paystack’s fee.
              </p>
            </section>
          )}

          <section className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Shop</h2>
            <dl className="space-y-3 p-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Name on the platform</dt>
                <dd className="text-foreground">{organization.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Web address</dt>
                <dd className="font-mono text-xs text-foreground">{organization.slug}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Joined</dt>
                <dd className="text-foreground">{formatDate(organization.createdAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Payments contact</h2>
            <dl className="space-y-3 p-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd className="text-foreground">{account.contactName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd className="break-all text-foreground">{account.contactEmail ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Phone</dt>
                <dd className="tabular-nums text-foreground">{account.contactPhone ?? '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">History</h2>
            {history.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">—</p>
            ) : (
              <ol className="space-y-3 p-4 text-sm">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <p className="text-foreground">{auditActionLabel(entry.action)}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.by ?? '—'} · <span title={formatDate(entry.at)}>{formatRelativeTime(entry.at, now)}</span>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>

      <AlertDialogRoot open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve {account.businessName ?? organization.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {missingDocs.length > 0
                ? `Some documents are missing (${missingDocs.map((kind) => DOCUMENTS[kind].label).join(', ')}). `
                : ''}
              This confirms the business and its documents check out. We then create their Paystack payout account for{' '}
              {account.settlementAccountName ?? 'their bank account'}, and email the merchant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <Button onClick={approve} disabled={busy !== null}>
              {busy === 'approve' && <Loader2 className="size-3.5 animate-spin" />}
              Approve business
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      <DialogRoot open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void reject();
            }}
          >
            <DialogHeader>
              <DialogTitle>Send back for changes</DialogTitle>
              <DialogDescription>
                The merchant sees this reason exactly as written, on their setup page and in an email. Say what to fix.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="reject-reason">Reason *</Label>
              <Textarea
                id="reject-reason"
                rows={4}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. The ID photo is too blurred to read. Upload a clearer photo of the front."
                aria-invalid={reasonError ? true : undefined}
              />
              {reasonError ? (
                <FieldError>{reasonError}</FieldError>
              ) : (
                <FieldDescription>{reason.trim().length}/500</FieldDescription>
              )}
            </div>
            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button type="button" variant="outline" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={busy !== null}>
                {busy === 'reject' && <Loader2 className="size-3.5 animate-spin" />}
                Send back to merchant
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
