'use client';

/*
 * "Alerts on this device" (ROADMAP 18.3) — on Settings → Notifications in
 * the admin, and the console's notification settings. Turns browser
 * notifications on or off for THIS browser, explains what to do when the
 * browser can't (an iPhone that hasn't installed the site, a blocked site,
 * an old browser), and lists the person's other browsers with a way to
 * remove each.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BellOff, BellRing, Loader2, MonitorSmartphone, Share, SquarePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import {
  currentSubscription,
  removeWebPushDevice,
  turnOffWebPush,
  turnOnWebPush,
  webPushState,
  webPushSupport,
  type WebPushState,
  type WebPushSupport,
} from '@/lib/notifications/web-push-client';
import type { BrowserView } from '@/lib/notifications/view';

export function DeviceAlerts({ route, devices, appName }: { route: string; devices: BrowserView[]; appName: string }) {
  const router = useRouter();
  const [support, setSupport] = React.useState<WebPushSupport | null>(null);
  const [state, setState] = React.useState<WebPushState | null>(null);
  const [endpoint, setEndpoint] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const supported = webPushSupport();
    setSupport(supported);
    if (supported !== 'ready') return;
    setState(await webPushState());
    setEndpoint((await currentSubscription())?.endpoint ?? null);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function turnOn() {
    setBusy('this');
    const result = await turnOnWebPush(route);
    setBusy(null);
    if (result === 'on') toast.success('Alerts are on for this browser');
    else if (result === 'blocked') toast.error('This browser blocked notifications for this site.');
    else toast.error('We couldn’t turn alerts on. Please try again.');
    await refresh();
    router.refresh();
  }

  async function turnOff() {
    setBusy('this');
    const ok = await turnOffWebPush(route);
    setBusy(null);
    if (ok) toast.success('Alerts are off for this browser');
    else toast.error('We couldn’t turn alerts off. Please try again.');
    await refresh();
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(id);
    const ok = await removeWebPushDevice(route, id);
    setBusy(null);
    if (ok) toast.success('That browser won’t get alerts any more');
    else toast.error('We couldn’t remove it. Please try again.');
    router.refresh();
  }

  const others = devices.filter((d) => d.endpoint !== endpoint);

  return (
    <section aria-labelledby="device-alerts" className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 id="device-alerts" className="text-sm font-semibold">
          Alerts on this device
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A notification on your phone or computer when something needs you, even with this page closed.
        </p>
      </div>

      <div className="px-4 py-4">
        {support === null || (support === 'ready' && state === null) ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Checking this browser…
          </p>
        ) : support === 'needs-install' ? (
          <InstallSteps appName={appName} />
        ) : support === 'unsupported' ? (
          <p className="text-sm text-muted-foreground">
            This browser can’t show notifications. Chrome, Edge, Firefox and Safari can.
          </p>
        ) : support === 'off' ? (
          <p className="text-sm text-muted-foreground">Alerts on devices aren’t available yet.</p>
        ) : state === 'blocked' ? (
          <div className="flex items-start gap-3">
            <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              This browser is blocking notifications from this site. Allow them in the browser’s site settings (the icon
              beside the address), then come back to this page.
            </p>
          </div>
        ) : state === 'on' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm">
              <BellRing className="size-4 text-primary" aria-hidden />
              <Badge variant="success">On</Badge>
              <span>for this browser</span>
            </p>
            <Button type="button" variant="outline" size="sm" onClick={turnOff} disabled={busy !== null}>
              {busy === 'this' && <Loader2 className="animate-spin" aria-hidden />}
              Turn off
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Your browser will ask for permission.</p>
            <Button type="button" size="sm" onClick={turnOn} disabled={busy !== null}>
              {busy === 'this' ? <Loader2 className="animate-spin" aria-hidden /> : <BellRing aria-hidden />}
              Turn on alerts
            </Button>
          </div>
        )}
      </div>

      {others.length > 0 && (
        <div className="border-t px-4 py-3">
          <h3 className="text-xs font-semibold text-muted-foreground">Your other devices</h3>
          <ul className="mt-2 divide-y">
            {others.map((device) => (
              <li key={device.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <MonitorSmartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{device.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">since {formatDate(device.createdAt)}</span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void remove(device.id)} disabled={busy !== null}>
                  {busy === device.id && <Loader2 className="animate-spin" aria-hidden />}
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** On an iPhone or iPad, notifications come only to a site added to the Home Screen. */
function InstallSteps({ appName }: { appName: string }) {
  return (
    <div>
      <p className="text-sm">On iPhone and iPad, alerts work once {appName} is on your Home Screen:</p>
      <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">1</span>
          Tap <Share className="size-4 text-foreground" aria-label="Share" /> at the bottom of Safari.
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">2</span>
          Choose <SquarePlus className="size-4 text-foreground" aria-hidden /> “Add to Home Screen”.
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">3</span>
          Open {appName} from your Home Screen and come back to this page.
        </li>
      </ol>
    </div>
  );
}
