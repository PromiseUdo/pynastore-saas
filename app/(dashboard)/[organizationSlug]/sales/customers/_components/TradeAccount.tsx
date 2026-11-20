'use client';

/*
 * Trade buyers in Customers (ROADMAP 21.1): the "Invite a trade buyer"
 * dialog on the list, and the Trade account card on a customer's page with
 * everything a merchant does to one — make, approve, decline, pause,
 * reinstate, correct the business details, send the sign-in invitation.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatDate } from '@/lib/format';
import { TRADE_STATUS_LABEL, TRADE_STATUS_VARIANT, type TradeStatus } from '@/lib/trade/rules';
import type { InviteResult } from '@/lib/trade/messages';
import {
  approveTradeBuyer,
  declineTradeRequest,
  inviteTradeBuyer,
  reinstateTradeBuyer,
  resendTradeInvite,
  saveTradeDetails,
  suspendTradeBuyer,
} from '@/features/sales/trade';

/** What happened to a sign-in invitation, in the merchant's words. */
const INVITE_WORDS: Record<InviteResult, string | null> = {
  sent: 'We’ve emailed them a link to set up their sign-in.',
  'has-sign-in': 'They can already sign in, so we’ve emailed them that they’re a wholesaler.',
  'no-email': 'They have no email address, so they can’t be invited to sign in. Add one first.',
  'too-soon': 'An invitation went out a moment ago — try again in a minute.',
  'not-sent': 'We couldn’t send the invitation email. Try again from their customer page.',
};

export function TradeStatusBadge({ status }: { status: TradeStatus }) {
  return <Badge variant={TRADE_STATUS_VARIANT[status]}>{TRADE_STATUS_LABEL[status]}</Badge>;
}

/* ---------------- business details fields ---------------- */

type Details = { businessName: string; taxId: string; cacNumber: string };

function BusinessFields({
  value,
  onChange,
  idPrefix,
  error,
}: {
  value: Details;
  onChange: (next: Details) => void;
  idPrefix: string;
  error?: string | null;
}) {
  return (
    <>
      <Field>
        <Label htmlFor={`${idPrefix}-business`}>Business name *</Label>
        <Input
          id={`${idPrefix}-business`}
          value={value.businessName}
          maxLength={150}
          onChange={(e) => onChange({ ...value, businessName: e.target.value })}
          aria-invalid={error ? true : undefined}
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`${idPrefix}-tin`}>Tax ID (TIN)</Label>
          <Input id={`${idPrefix}-tin`} value={value.taxId} maxLength={60} onChange={(e) => onChange({ ...value, taxId: e.target.value })} />
          <FieldDescription>Shown on their invoices.</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-cac`}>CAC number</Label>
          <Input
            id={`${idPrefix}-cac`}
            value={value.cacNumber}
            maxLength={40}
            placeholder="RC 1234567"
            onChange={(e) => onChange({ ...value, cacNumber: e.target.value })}
          />
          <FieldDescription>Their company registration, if they have one.</FieldDescription>
        </Field>
      </div>
    </>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

const toInput = (d: Details) => ({ businessName: d.businessName, taxId: d.taxId || null, cacNumber: d.cacNumber || null });

/* ---------------- invite (from the list) ---------------- */

export function InviteTradeBuyerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [details, setDetails] = React.useState<Details>({ businessName: '', taxId: '', cacNumber: '' });
  const [errors, setErrors] = React.useState<{ name?: string; email?: string; business?: string; form?: string }>({});
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setPhone('');
    setDetails({ businessName: '', taxId: '', cacNumber: '' });
    setErrors({});
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Enter their name.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter their email address — the invitation goes there.';
    if (details.businessName.trim().length < 2) next.business = 'Enter the business name.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setPending(true);
    const result = await inviteTradeBuyer({ name, email, phone: phone || undefined, ...toInput(details) });
    setPending(false);
    if (!result.success) {
      setErrors({ form: result.error });
      return;
    }
    const words = INVITE_WORDS[result.data.invite];
    if (result.data.invite === 'sent' || result.data.invite === 'has-sign-in') toast.success(`${details.businessName} is a wholesaler. ${words}`);
    else toast.warning(`${details.businessName} is a wholesaler. ${words}`);
    onOpenChange(false);
    router.push(`/sales/customers/${result.data.customerId}`);
  }

  return (
    <DialogRoot open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Invite a wholesaler</DialogTitle>
            <DialogDescription>
              A business you already supply. They become a wholesaler straight away, and we email them a link to set up
              their sign-in. If they’re already a customer, we use that record.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <FormError message={errors.form ?? null} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="invite-name">Contact name *</Label>
                <Input id="invite-name" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>
              <Field>
                <Label htmlFor="invite-phone">Phone</Label>
                <Input id="invite-phone" type="tel" inputMode="tel" value={phone} placeholder="0803 123 4567" onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
            <Field>
              <Label htmlFor="invite-email">Email *</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                maxLength={150}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={errors.email ? true : undefined}
              />
              {errors.email && <FieldError>{errors.email}</FieldError>}
            </Field>
            <BusinessFields value={details} onChange={setDetails} idPrefix="invite" error={errors.business} />
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Invite wholesaler
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

/* ---------------- the card on a customer's page ---------------- */

export interface TradeCardData {
  status: TradeStatus;
  businessName: string;
  cacNumber: string | null;
  requestNote: string | null;
  decisionReason: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
}

type Dialog = 'make' | 'approve' | 'edit' | 'decline' | 'suspend' | null;

export function TradeAccountCard({
  customerId,
  customerName,
  taxId,
  canSignIn,
  hasEmail,
  trade,
  wholesaleOn,
  canManage,
}: {
  customerId: string;
  customerName: string;
  taxId: string | null;
  canSignIn: boolean;
  hasEmail: boolean;
  trade: TradeCardData | null;
  wholesaleOn: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [pending, setPending] = React.useState(false);

  // Nothing to show: wholesale is off and they never were a trade buyer.
  if (!trade && !wholesaleOn) return null;

  async function run(action: () => Promise<{ success: true; data: unknown } | { success: false; error: string }>, done: string) {
    setPending(true);
    const result = await action();
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(done);
    setDialog(null);
    router.refresh();
  }

  async function resend() {
    setPending(true);
    const result = await resendTradeInvite(customerId);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    const words = INVITE_WORDS[result.data.invite];
    if (result.data.invite === 'sent') toast.success(words);
    else toast.warning(words);
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Building2 className="size-3.5 text-muted-foreground" aria-hidden />
          Wholesale account
        </h2>
        {trade && <TradeStatusBadge status={trade.status} />}
      </div>

      {!trade ? (
        <>
          <p className="text-xs text-muted-foreground">
            Not a wholesaler. Make them one if they buy for a business you supply.
          </p>
          {canManage && (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setDialog('make')}>
              Make wholesaler
            </Button>
          )}
        </>
      ) : (
        <>
          <dl className="space-y-1.5">
            <Row label="Business" value={trade.businessName} />
            <Row label="Tax ID" value={taxId} />
            <Row label="CAC number" value={trade.cacNumber} />
          </dl>

          {trade.status === 'REQUESTED' && (
            <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs">
              <p>
                Asked {trade.requestedAt ? formatDate(trade.requestedAt) : ''} from your shop. Waiting for your answer — they
                shop at your normal prices until then.
              </p>
              {trade.requestNote && <p className="text-muted-foreground">“{trade.requestNote}”</p>}
            </div>
          )}
          {trade.status === 'APPROVED' && (
            <p className="text-xs text-muted-foreground">
              Approved{trade.decidedAt ? ` ${formatDate(trade.decidedAt)}` : ''}
              {trade.decidedByName ? ` by ${trade.decidedByName}` : ''}.
              {!wholesaleOn && ' Wholesale is off, so wholesale terms don’t apply right now.'}
              {!canSignIn && (hasEmail ? ' They haven’t set up their sign-in yet.' : ' They have no email, so they can’t sign in to your shop.')}
            </p>
          )}
          {(trade.status === 'DECLINED' || trade.status === 'SUSPENDED') && (
            <p className="text-xs text-muted-foreground">
              {trade.status === 'DECLINED' ? 'Declined' : 'Paused'}
              {trade.decidedAt ? ` ${formatDate(trade.decidedAt)}` : ''}
              {trade.decidedByName ? ` by ${trade.decidedByName}` : ''}.
              {trade.decisionReason ? ` Your note: “${trade.decisionReason}”` : ''}
              {trade.status === 'DECLINED' && ' They may ask again.'}
            </p>
          )}

          {canManage && (
            <div className="flex flex-wrap gap-2">
              {trade.status === 'REQUESTED' && (
                <>
                  <Button size="sm" onClick={() => setDialog('approve')} disabled={pending || !wholesaleOn}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDialog('decline')} disabled={pending}>
                    Decline
                  </Button>
                </>
              )}
              {trade.status === 'DECLINED' && (
                <Button size="sm" variant="outline" onClick={() => setDialog('approve')} disabled={pending || !wholesaleOn}>
                  Approve after all
                </Button>
              )}
              {trade.status === 'APPROVED' && (
                <>
                  {!canSignIn && hasEmail && (
                    <Button size="sm" variant="outline" onClick={resend} disabled={pending}>
                      Send sign-in invitation
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDialog('suspend')} disabled={pending}>
                    Pause
                  </Button>
                </>
              )}
              {trade.status === 'SUSPENDED' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => run(() => reinstateTradeBuyer(customerId), `${trade.businessName} is a wholesaler again`)}
                  disabled={pending || !wholesaleOn}
                >
                  {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  Reinstate
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setDialog('edit')} disabled={pending}>
                Edit details
              </Button>
            </div>
          )}
          {canManage && !wholesaleOn && trade.status !== 'APPROVED' && (
            <p className="text-xs text-muted-foreground">
              Turn on wholesale in{' '}
              <Link href="/settings/wholesale" className="font-medium text-primary hover:underline">
                Settings → Wholesale
              </Link>{' '}
              to approve wholesalers.
            </p>
          )}
        </>
      )}

      {(dialog === 'make' || dialog === 'approve' || dialog === 'edit') && (
        <DetailsDialog
          mode={dialog}
          initial={{
            businessName: trade?.businessName ?? customerName,
            taxId: taxId ?? '',
            cacNumber: trade?.cacNumber ?? '',
          }}
          offerInvite={dialog !== 'edit' && !canSignIn && hasEmail}
          wholesaleOn={wholesaleOn}
          onClose={() => setDialog(null)}
          onSave={async (details, invite) => {
            if (dialog === 'edit') {
              await run(() => saveTradeDetails(customerId, details), 'Business details saved');
              return;
            }
            setPending(true);
            const result = await approveTradeBuyer(customerId, { details, invite });
            setPending(false);
            if (!result.success) {
              toast.error(result.error);
              return;
            }
            const inviteWords = result.data.invite ? INVITE_WORDS[result.data.invite] : null;
            const message = `${details.businessName} is a wholesaler${inviteWords ? `. ${inviteWords}` : ' — they’ve been emailed'}`;
            if (result.data.invite && result.data.invite !== 'sent' && result.data.invite !== 'has-sign-in') toast.warning(message);
            else toast.success(message);
            setDialog(null);
            router.refresh();
          }}
        />
      )}

      {(dialog === 'decline' || dialog === 'suspend') && trade && (
        <ReasonDialog
          kind={dialog}
          businessName={trade.businessName}
          onClose={() => setDialog(null)}
          onConfirm={(reason) =>
            run(
              () => (dialog === 'decline' ? declineTradeRequest(customerId, { reason }) : suspendTradeBuyer(customerId, { reason })),
              dialog === 'decline' ? 'Request declined — they’ve been told' : 'Wholesale account paused — they’ve been told',
            )
          }
          pending={pending}
        />
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right">{value || '—'}</dd>
    </div>
  );
}

function DetailsDialog({
  mode,
  initial,
  offerInvite,
  wholesaleOn,
  onClose,
  onSave,
}: {
  mode: 'make' | 'approve' | 'edit';
  initial: Details;
  offerInvite: boolean;
  wholesaleOn: boolean;
  onClose: () => void;
  onSave: (details: ReturnType<typeof toInput>, invite: boolean) => Promise<void>;
}) {
  const [details, setDetails] = React.useState<Details>(initial);
  const [invite, setInvite] = React.useState(offerInvite);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (details.businessName.trim().length < 2) {
      setError('Enter the business name.');
      return;
    }
    setError(null);
    setPending(true);
    await onSave(toInput(details), offerInvite && invite);
    setPending(false);
  }

  const title = mode === 'edit' ? 'Business details' : mode === 'approve' ? 'Approve wholesale account' : 'Make wholesaler';
  const action = mode === 'edit' ? 'Save details' : mode === 'approve' ? 'Approve wholesaler' : 'Make wholesaler';

  return (
    <DialogRoot open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {mode === 'edit'
                ? 'Correct the business they buy for.'
                : 'They’ll shop as a wholesaler from now on, and we’ll email to tell them.'}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {mode !== 'edit' && !wholesaleOn && (
              <FormError message="Wholesale is off. Turn it on in Settings → Wholesale first." />
            )}
            <BusinessFields value={details} onChange={setDetails} idPrefix="trade" error={error} />
            {offerInvite && (
              <label htmlFor="trade-invite" className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3">
                <CheckboxRoot id="trade-invite" className="mt-0.5" checked={invite} onCheckedChange={(c) => setInvite(c === true)} />
                <span>
                  <span className="block text-sm font-medium">Email them a sign-in invitation</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    They don’t have a sign-in for your shop yet. The link lets them choose a password; it lasts a week.
                  </span>
                </span>
              </label>
            )}
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending || (mode !== 'edit' && !wholesaleOn)}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function ReasonDialog({
  kind,
  businessName,
  onClose,
  onConfirm,
  pending,
}: {
  kind: 'decline' | 'suspend';
  businessName: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = React.useState('');
  return (
    <AlertDialogRoot open onOpenChange={(next) => !next && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{kind === 'decline' ? `Decline ${businessName}’s request?` : `Pause ${businessName}’s wholesale account?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {kind === 'decline'
              ? 'They’ll be emailed that you can’t open a wholesale account for them now, and can still shop at your normal prices. They may ask again later.'
              : 'Wholesale terms stop applying to them until you reinstate the account, and they’ll be emailed that it’s paused.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <Label htmlFor="trade-reason">Note for them (optional)</Label>
          <Textarea id="trade-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <FieldDescription>Included in the email they get.</FieldDescription>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={pending}>
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {kind === 'decline' ? 'Decline request' : 'Pause wholesale account'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>
  );
}
