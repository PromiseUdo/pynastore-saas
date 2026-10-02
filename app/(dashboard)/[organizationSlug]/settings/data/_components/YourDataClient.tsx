'use client';

/*
 * Settings → Your data. Downloads first — the Owner's own copy, and what they
 * should take before closing — then closing the workspace, with every
 * consequence said before the button and the name typed to confirm.
 */
import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogRoot,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { closeWorkspaceAction } from '@/features/settings/data';

export function YourDataClient({
  workspaceName,
  datasets,
  graceDays,
  retentionYears,
}: {
  workspaceName: string;
  datasets: { key: string; label: string }[];
  graceDays: number;
  retentionYears: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [confirmName, setConfirmName] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const matches = confirmName.trim() === workspaceName.trim();

  function close() {
    setError(null);
    startTransition(async () => {
      const result = await closeWorkspaceAction({ confirmName, reason });
      if (!result.success) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      // The workspace is gone: leave it for the platform's home page (another host).
      window.location.assign(result.data.next);
    });
  }

  return (
    <>
      <PageHeader title="Your data" description="Download your workspace’s records, or close the workspace." />
      <PageBody>
        <div className="max-w-3xl space-y-8">
          <section aria-labelledby="downloads" className="space-y-3">
            <div>
              <h2 id="downloads" className="text-sm font-semibold text-foreground">
                Download your records
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Spreadsheets of everything in the workspace, as it is right now. Keep a copy before closing.
              </p>
            </div>
            <ul className="divide-y rounded-lg border bg-card">
              {datasets.map((d) => (
                <li key={d.key} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm text-foreground">{d.label}</span>
                  <Button asChild variant="outline" size="sm">
                    <a href={`/settings/data/export/${d.key}`} download>
                      <Download className="size-3.5" aria-hidden />
                      Download CSV
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="close" className="space-y-3 rounded-lg border border-destructive/30 p-4">
            <div>
              <h2 id="close" className="text-sm font-semibold text-foreground">
                Close this workspace
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">For when you’re stopping for good. Only an Owner can do this.</p>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              <li>Your dashboard and online store go offline straight away, for everyone, and your plan stops renewing.</li>
              <li>
                For {graceDays} days we can restore everything if you change your mind — write to us. After that it can’t be undone.
              </li>
              <li>
                After {graceDays} days, your photos and files, store pages, staff access and your customers’ account details and
                contact details are deleted.
              </li>
              <li>
                Orders, invoices and payment records are kept for {retentionYears} years, as the law requires business records to
                be, then erased along with everything else.
              </li>
            </ul>
            <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
              Close workspace
            </Button>
          </section>
        </div>

        <AlertDialogRoot
          open={open}
          onOpenChange={(next) => {
            if (pending) return;
            setOpen(next);
            if (!next) {
              setConfirmName('');
              setError(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Close {workspaceName}?</AlertDialogTitle>
              <AlertDialogDescription>
                Your dashboard and store go offline now for everyone. After {graceDays} days your data starts being deleted and
                it can’t be restored.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4">
              {error && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="confirm-name">
                  Type <span className="font-semibold">{workspaceName}</span> to confirm <span className="text-destructive">*</span>
                </Label>
                <Input id="confirm-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="close-reason">Why are you closing? (optional)</Label>
                <Textarea id="close-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
                <p className="text-xs text-muted-foreground">Only our team sees this. It helps us improve.</p>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Keep workspace</AlertDialogCancel>
              <Button variant="destructive" onClick={close} disabled={!matches || pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Close workspace
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogRoot>
      </PageBody>
    </>
  );
}
