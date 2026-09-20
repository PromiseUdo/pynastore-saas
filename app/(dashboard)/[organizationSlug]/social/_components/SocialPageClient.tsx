'use client';

/*
 * The connected-accounts list.
 *
 * One row per account with the four things a shop owner needs: which
 * platform, which account, whether it's working, and how to remove it.
 *
 * Nothing on this screen has ever seen an access token — `SocialAccountRow`
 * has no token field (lib/social/types.ts), so there is nothing to leak into
 * the page's HTML.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Share2, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
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
import {
  disconnectSocialAccount,
  recheckSocialAccount,
  startSocialConnect,
  type SocialOverview,
} from '@/features/social/actions';
import { PlatformIcon } from '@/components/social/platform-icon';
import { SocialNav } from '@/components/social/social-nav';
import {
  CONNECTION_STATUS_LABELS,
  PLATFORM_LABELS,
  type SocialAccountRow,
  type SocialConnectionStatus,
} from '@/lib/social/types';

const STATUS_VARIANTS: Record<SocialConnectionStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  ACTIVE: 'success',
  EXPIRED: 'warning',
  REVOKED: 'destructive',
  DISCONNECTED: 'muted',
};

/** What went wrong on the way back from Meta, said plainly. */
const CONNECT_ERRORS: Record<string, string> = {
  denied: 'You cancelled the Facebook sign-in, so nothing was connected.',
  expired: 'That connection attempt timed out. Please try again.',
  signed_out: 'You were signed out during the connection. Sign in and try again.',
  forbidden: 'You don’t have permission to connect social accounts for this store.',
  no_pages: 'Facebook didn’t return any Pages for your account. Create a Facebook Page first, then try again.',
  permissions:
    'Facebook didn’t grant everything we need. Try again and leave all the requested permissions switched on.',
  meta: 'We couldn’t finish the connection with Facebook. Please try again in a moment.',
};

export function SocialPageClient({
  accounts,
  providers,
  canManage,
  connectError,
}: {
  accounts: SocialAccountRow[];
  providers: SocialOverview['providers'];
  canManage: boolean;
  connectError: string | null;
}) {
  const router = useRouter();
  const [connecting, setConnecting] = React.useState<string | null>(null);
  const [rechecking, setRechecking] = React.useState<string | null>(null);
  const [disconnecting, setDisconnecting] = React.useState<SocialAccountRow | null>(null);
  const [pending, setPending] = React.useState(false);

  /* The callback route can only speak in reason codes — it has no session UI
   * of its own — so the message is assembled here, once, on arrival. */
  const reportedError = React.useRef(false);
  React.useEffect(() => {
    if (!connectError || reportedError.current) return;
    reportedError.current = true;
    toast.error(CONNECT_ERRORS[connectError] ?? CONNECT_ERRORS.meta);
    const url = new URL(window.location.href);
    url.searchParams.delete('social_error');
    router.replace(url.pathname + url.search, { scroll: false });
  }, [connectError, router]);

  const meta = providers.find((p) => p.key === 'meta');
  const unavailable = providers.filter((p) => !p.configured);

  async function handleConnect(providerKey: string) {
    setConnecting(providerKey);
    const result = await startSocialConnect(providerKey);
    if (!result.success) {
      setConnecting(null);
      toast.error(result.error);
      return;
    }
    // A full navigation, not a router push: the next stop is facebook.com.
    window.location.href = result.data.url;
  }

  async function handleRecheck(account: SocialAccountRow) {
    setRechecking(account.id);
    const result = await recheckSocialAccount(account.id);
    setRechecking(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      result.data.status === 'ACTIVE'
        ? `${result.data.accountName} is connected and working`
        : `${result.data.accountName} needs reconnecting`,
    );
    router.refresh();
  }

  async function handleDisconnect() {
    if (!disconnecting) return;
    setPending(true);
    const result = await disconnectSocialAccount(disconnecting.id);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`${disconnecting.accountName} disconnected`);
    setDisconnecting(null);
    router.refresh();
  }

  const connectButton = meta?.configured && canManage && (
    <Button onClick={() => handleConnect('meta')} disabled={connecting !== null}>
      {connecting === 'meta' ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <PlatformIcon platform="FACEBOOK_PAGE" />
      )}
      Connect Facebook or Instagram
    </Button>
  );

  return (
    <div>
      <PageHeader
        title="Social accounts"
        description="Connect the Facebook Page and Instagram account this store posts from."
        actions={connectButton || undefined}
      />
      <SocialNav />

      <PageBody>
        {accounts.length === 0 ? (
          <EmptyState
            icon={Share2}
            title="No social accounts connected"
            description={
              canManage
                ? 'Connect your store’s Facebook Page and Instagram professional account so you can post your products to them. You sign in with your own Facebook account — MansaaS never asks for a password or an app key.'
                : 'Nobody has connected a Facebook Page or Instagram account to this store yet. Ask an owner or admin to set it up.'
            }
            action={connectButton || undefined}
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Account</TableColumnHeader>
                  <TableColumnHeader>Platform</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader>Connected</TableColumnHeader>
                  {canManage && <TableColumnHeader className="text-right">Actions</TableColumnHeader>}
                </TableRow>
              </TableHead>
              <TableBody>
                {accounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <PlatformIcon platform={account.platform} />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{account.accountName}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {account.username ? `@${account.username}` : '—'}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{PLATFORM_LABELS[account.platform]}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[account.status]} dot>
                          {CONNECTION_STATUS_LABELS[account.status]}
                        </Badge>
                        {account.problem && (
                          <p className="mt-1 max-w-xs text-xs text-muted-foreground">{account.problem}</p>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatDate(account.connectedAt)}</TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRecheck(account)}
                              disabled={rechecking === account.id}
                              aria-label={`Check ${account.accountName}`}
                            >
                              {rechecking === account.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <RefreshCw className="size-4" />
                              )}
                              Check
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDisconnecting(account)}
                              aria-label={`Disconnect ${account.accountName}`}
                            >
                              <Unplug className="size-4" />
                              Disconnect
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}

        {/* Platforms that exist in the app but aren't switched on here. Said
            out loud rather than hidden, so nobody goes looking for a button
            that was quietly removed. */}
        {unavailable.length > 0 && (
          <div className="mt-6 rounded-lg border border-dashed px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Coming later</h2>
            <ul className="mt-2 space-y-1">
              {unavailable.map((provider) => (
                <li key={provider.key} className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{provider.label}</span> — {provider.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </PageBody>

      <AlertDialogRoot open={disconnecting !== null} onOpenChange={(open) => !open && setDisconnecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {disconnecting?.accountName}?</AlertDialogTitle>
            <AlertDialogDescription>
              MansaaS will stop posting to this account and will forget its access. Posts you already published stay
              on {disconnecting ? PLATFORM_LABELS[disconnecting.platform] : 'the platform'}.
              {disconnecting?.platform === 'FACEBOOK_PAGE' &&
                ' Any Instagram account linked to this Page is disconnected too, because it posts through the Page.'}{' '}
              You can connect it again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it connected</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDisconnect} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Disconnect account
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}
