'use client';

/*
 * Settings → Your account, the security half (ROADMAP 14.5): your name and
 * email, your password, two-step sign-in, and signing out other devices.
 * Always the signed-in person's own account (features/account/security.ts).
 * Each change is short, so each is a dialog; the backup codes are shown once.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, KeyRound, Loader2, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogRoot,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  changePasswordAction,
  confirmTwoFactorAction,
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
  requestEmailChangeAction,
  signOutOtherDevicesAction,
  startTwoFactorAction,
  updateNameAction,
} from '@/features/account/security';

export interface AccountSecurityProps {
  name: string | null;
  email: string;
  hasPassword: boolean;
  /** "Google", "Apple" — the other ways this account signs in */
  otherSignIns: string[];
  twoFactor: { enabled: boolean; recoveryCodesLeft: number };
}

type Dialog = 'name' | 'email' | 'password' | 'two-factor-on' | 'two-factor-off' | 'codes' | null;

function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

function Card({
  icon: Icon,
  title,
  badge,
  children,
  action,
}: {
  icon: typeof KeyRound;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{title}</h2>
              {badge}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">{children}</div>
          </div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap gap-2 self-start">{action}</div>}
      </div>
    </section>
  );
}

/** Shown once: the ten backup codes, with a way to copy them. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm">
        Keep these somewhere safe, like a password manager. Each works once, if you can’t use your phone. You won’t see them
        again.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm tabular-nums">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast.success('Backup codes copied'), () => toast.error('Couldn’t copy them — write them down instead'))}
        >
          <Copy className="size-3.5" aria-hidden />
          Copy codes
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          I’ve saved them
        </Button>
      </DialogFooter>
    </div>
  );
}

/** The 6-digit code from the app, or a backup code. */
function CodeInput({ id, value, onChange, error, allowBackup }: { id: string; value: string; onChange: (v: string) => void; error?: string; allowBackup: boolean }) {
  return (
    <Field>
      <Label htmlFor={id}>{allowBackup ? 'Code from your app, or a backup code *' : 'Code from your app *'}</Label>
      <Input
        id={id}
        inputMode={allowBackup ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 20))}
        aria-invalid={error ? true : undefined}
        className="w-48 tracking-[0.2em] tabular-nums"
      />
      {error ? <FieldError>{error}</FieldError> : <FieldDescription>Authenticator codes change every 30 seconds.</FieldDescription>}
    </Field>
  );
}

export function AccountSecurity({ name, email, hasPassword, otherSignIns, twoFactor }: AccountSecurityProps) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [setup, setSetup] = React.useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [signOutOpen, setSignOutOpen] = React.useState(false);

  const value = (key: string) => form[key] ?? '';
  const set = (key: string) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  function open(next: Dialog, initial: Record<string, string> = {}) {
    setErrors({});
    setForm(initial);
    setSetup(null);
    setCodes(null);
    setDialog(next);
  }
  function close() {
    if (pending) return;
    // Backup codes on screen: closing means they were saved.
    if (codes) router.refresh();
    setDialog(null);
  }

  async function run<T>(work: () => Promise<{ success: true; data: T } | { success: false; error: string; field?: string }>): Promise<T | null> {
    setPending(true);
    setErrors({});
    const result = await work();
    setPending(false);
    if (!result.success) {
      setErrors(result.field ? { [result.field]: result.error } : { form: result.error });
      return null;
    }
    return result.data;
  }

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if ((await run(() => updateNameAction(value('name')))) === null) return;
    toast.success('Name saved');
    setDialog(null);
    router.refresh();
  }

  async function changeEmail(event: React.FormEvent) {
    event.preventDefault();
    const done = await run(() => requestEmailChangeAction({ newEmail: value('email'), password: value('password') }));
    if (!done) return;
    toast.success(`We sent a link to ${done.newEmail}. Your email changes once you open it.`);
    setDialog(null);
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (value('next') !== value('confirm')) return setErrors({ confirm: 'The two new passwords don’t match.' });
    if ((await run(() => changePasswordAction({ current: value('current'), next: value('next') }))) === null) return;
    toast.success('Password changed. Your other devices were signed out.');
    setDialog(null);
    router.refresh();
  }

  async function beginTwoFactor() {
    open('two-factor-on');
    const started = await run(() => startTwoFactorAction());
    if (started) setSetup(started);
  }

  async function confirmTwoFactor(event: React.FormEvent) {
    event.preventDefault();
    const done = await run(() => confirmTwoFactorAction(value('code')));
    if (done) setCodes(done.recoveryCodes);
  }

  async function turnOff(event: React.FormEvent) {
    event.preventDefault();
    if ((await run(() => disableTwoFactorAction(value('code')))) === null) return;
    toast.success('Two-step sign-in is off');
    setDialog(null);
    router.refresh();
  }

  async function newCodes(event: React.FormEvent) {
    event.preventDefault();
    const done = await run(() => regenerateRecoveryCodesAction(value('code')));
    if (done) setCodes(done.recoveryCodes);
  }

  async function signOutOthers() {
    setPending(true);
    const result = await signOutOtherDevicesAction();
    setPending(false);
    setSignOutOpen(false);
    if (result.success) toast.success('Every other device was signed out');
    else toast.error(result.error);
  }

  const signsInWith = [hasPassword && 'Email and password', ...otherSignIns].filter(Boolean).join(', ');

  return (
    <div className="space-y-4">
      <Card
        icon={UserRound}
        title="Profile"
        action={
          <>
            <Button size="sm" variant="outline" onClick={() => open('name', { name: name ?? '' })}>
              Edit name
            </Button>
            <Button size="sm" variant="outline" onClick={() => open('email')}>
              Change email
            </Button>
          </>
        }
      >
        <p>
          {name ?? '—'} · <span className="break-all">{email}</span>
        </p>
        <p className="text-xs">Signs in with {signsInWith || '—'}.</p>
      </Card>

      <Card
        icon={KeyRound}
        title="Password"
        action={
          hasPassword ? (
            <Button size="sm" variant="outline" onClick={() => open('password')}>
              Change password
            </Button>
          ) : undefined
        }
      >
        {hasPassword ? 'Changing it signs out your other devices.' : `This account signs in with ${otherSignIns.join(' or ') || 'another service'}, so it has no password here.`}
      </Card>

      <Card
        icon={ShieldCheck}
        title="Two-step sign-in"
        badge={hasPassword ? <Badge variant={twoFactor.enabled ? 'success' : 'draft'}>{twoFactor.enabled ? 'On' : 'Off'}</Badge> : undefined}
        action={
          hasPassword ? (
            twoFactor.enabled ? (
              <>
                <Button size="sm" variant="outline" onClick={() => open('codes')}>
                  New backup codes
                </Button>
                <Button size="sm" variant="outline" onClick={() => open('two-factor-off')}>
                  Turn off
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={beginTwoFactor}>
                Turn on
              </Button>
            )
          ) : undefined
        }
      >
        {!hasPassword ? (
          `Signing in with ${otherSignIns.join(' or ') || 'another service'} already has its own two-step check.`
        ) : twoFactor.enabled ? (
          <>
            Signing in with your password also asks for a code from your authenticator app. {twoFactor.recoveryCodesLeft} of 10 backup
            codes left.
          </>
        ) : (
          'After your password, ask for a code from an authenticator app on your phone.'
        )}
      </Card>

      <Card
        icon={LogOut}
        title="Signed-in devices"
        action={
          <Button size="sm" variant="outline" onClick={() => setSignOutOpen(true)}>
            Sign out other devices
          </Button>
        }
      >
        Lost a phone, or signed in on someone else’s computer? Sign out everywhere except here.
      </Card>

      {/* ---------------- dialogs ---------------- */}

      <DialogRoot open={dialog !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          {dialog === 'name' && (
            <form onSubmit={saveName} noValidate>
              <DialogHeader>
                <DialogTitle>Edit your name</DialogTitle>
                <DialogDescription>How you appear to the people you work with.</DialogDescription>
              </DialogHeader>
              {errors.form && <FormError>{errors.form}</FormError>}
              <div className="mt-4">
                <Field>
                  <Label htmlFor="account-name">Name *</Label>
                  <Input id="account-name" value={value('name')} onChange={(e) => set('name')(e.target.value)} aria-invalid={errors.name ? true : undefined} autoFocus />
                  {errors.name && <FieldError>{errors.name}</FieldError>}
                </Field>
              </div>
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  Save name
                </Button>
              </DialogFooter>
            </form>
          )}

          {dialog === 'email' && (
            <form onSubmit={changeEmail} noValidate>
              <DialogHeader>
                <DialogTitle>Change your email</DialogTitle>
                <DialogDescription>We’ll send a link to the new address. Your email changes once you open it, and {email} is told.</DialogDescription>
              </DialogHeader>
              {errors.form && <FormError>{errors.form}</FormError>}
              <div className="mt-4 space-y-4">
                <Field>
                  <Label htmlFor="account-email">New email *</Label>
                  <Input id="account-email" type="email" value={value('email')} onChange={(e) => set('email')(e.target.value)} aria-invalid={errors.email ? true : undefined} autoFocus />
                  {errors.email && <FieldError>{errors.email}</FieldError>}
                </Field>
                {hasPassword && (
                  <Field>
                    <Label htmlFor="account-email-password">Your password *</Label>
                    <Input
                      id="account-email-password"
                      type="password"
                      autoComplete="current-password"
                      value={value('password')}
                      onChange={(e) => set('password')(e.target.value)}
                      aria-invalid={errors.password ? true : undefined}
                    />
                    {errors.password && <FieldError>{errors.password}</FieldError>}
                  </Field>
                )}
              </div>
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  Send link
                </Button>
              </DialogFooter>
            </form>
          )}

          {dialog === 'password' && (
            <form onSubmit={changePassword} noValidate>
              <DialogHeader>
                <DialogTitle>Change your password</DialogTitle>
                <DialogDescription>Your other devices will be signed out, and we’ll email you to say it changed.</DialogDescription>
              </DialogHeader>
              {errors.form && <FormError>{errors.form}</FormError>}
              <div className="mt-4 space-y-4">
                <Field>
                  <Label htmlFor="password-current">Current password *</Label>
                  <Input id="password-current" type="password" autoComplete="current-password" value={value('current')} onChange={(e) => set('current')(e.target.value)} aria-invalid={errors.current ? true : undefined} autoFocus />
                  {errors.current && <FieldError>{errors.current}</FieldError>}
                </Field>
                <Field>
                  <Label htmlFor="password-next">New password *</Label>
                  <Input id="password-next" type="password" autoComplete="new-password" value={value('next')} onChange={(e) => set('next')(e.target.value)} aria-invalid={errors.next ? true : undefined} />
                  {errors.next ? <FieldError>{errors.next}</FieldError> : <FieldDescription>At least 8 characters.</FieldDescription>}
                </Field>
                <Field>
                  <Label htmlFor="password-confirm">New password again *</Label>
                  <Input id="password-confirm" type="password" autoComplete="new-password" value={value('confirm')} onChange={(e) => set('confirm')(e.target.value)} aria-invalid={errors.confirm ? true : undefined} />
                  {errors.confirm && <FieldError>{errors.confirm}</FieldError>}
                </Field>
              </div>
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  Change password
                </Button>
              </DialogFooter>
            </form>
          )}

          {dialog === 'two-factor-on' && (
            <>
              <DialogHeader>
                <DialogTitle>{codes ? 'Save your backup codes' : 'Turn on two-step sign-in'}</DialogTitle>
                {!codes && (
                  <DialogDescription>
                    Scan this with an authenticator app — Google Authenticator, Microsoft Authenticator or any other — then enter
                    the code it shows.
                  </DialogDescription>
                )}
              </DialogHeader>
              {errors.form && <FormError>{errors.form}</FormError>}
              {codes ? (
                <RecoveryCodes codes={codes} onDone={close} />
              ) : !setup ? (
                !errors.form && (
                  <p role="status" className="mt-4 flex items-center gap-2 text-sm">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Getting it ready…
                  </p>
                )
              ) : (
                <form onSubmit={confirmTwoFactor} noValidate>
                  <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL made on the server */}
                    <img src={setup.qr} alt="QR code to scan with your authenticator app" width={180} height={180} className="rounded-md border bg-white p-1" />
                    <div className="min-w-0 space-y-2 text-sm">
                      <p className="text-muted-foreground">Can’t scan it? Type this key into the app:</p>
                      <p className="break-all font-mono text-xs tabular-nums">{setup.secret}</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <CodeInput id="two-factor-setup-code" value={value('code')} onChange={set('code')} error={errors.code} allowBackup={false} />
                  </div>
                  <DialogFooter className="mt-6">
                    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={close}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={pending}>
                      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                      Turn on
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </>
          )}

          {dialog === 'two-factor-off' && (
            <form onSubmit={turnOff} noValidate>
              <DialogHeader>
                <DialogTitle>Turn off two-step sign-in?</DialogTitle>
                <DialogDescription>
                  Your password alone will sign you in again. We’ll email you that it was turned off.
                </DialogDescription>
              </DialogHeader>
              {errors.form && <FormError>{errors.form}</FormError>}
              <div className="mt-4">
                <CodeInput id="two-factor-off-code" value={value('code')} onChange={set('code')} error={errors.code} allowBackup />
              </div>
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={close}>
                  Keep it on
                </Button>
                <Button type="submit" variant="destructive" size="sm" disabled={pending}>
                  {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  Turn off
                </Button>
              </DialogFooter>
            </form>
          )}

          {dialog === 'codes' && (
            <>
              <DialogHeader>
                <DialogTitle>{codes ? 'Save your new backup codes' : 'Make new backup codes'}</DialogTitle>
                {!codes && <DialogDescription>Your old backup codes stop working.</DialogDescription>}
              </DialogHeader>
              {errors.form && <FormError>{errors.form}</FormError>}
              {codes ? (
                <RecoveryCodes codes={codes} onDone={close} />
              ) : (
                <form onSubmit={newCodes} noValidate>
                  <div className="mt-4">
                    <CodeInput id="two-factor-codes-code" value={value('code')} onChange={set('code')} error={errors.code} allowBackup={false} />
                  </div>
                  <DialogFooter className="mt-6">
                    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={close}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={pending}>
                      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                      Make new codes
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </>
          )}
        </DialogContent>
      </DialogRoot>

      <AlertDialogRoot open={signOutOpen} onOpenChange={(next) => !pending && setSignOutOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out every other device?</AlertDialogTitle>
            <AlertDialogDescription>
              Anywhere else you’re signed in — other browsers, phones, the business app — will need to sign in again. You stay
              signed in here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => void signOutOthers()}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Sign out other devices
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}
