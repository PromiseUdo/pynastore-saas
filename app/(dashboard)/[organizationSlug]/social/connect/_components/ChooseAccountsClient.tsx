'use client';

/*
 * The account chooser.
 *
 * A merchant's Facebook account can administer several Pages, and each Page
 * may have an Instagram professional account attached. Connecting all of
 * them silently would be presumptuous — a shop owner often administers a
 * personal Page and a business Page — so they pick.
 *
 * What's on this screen: names, handles, pictures and whether each one can
 * be used. No tokens: `SocialCandidate` has no token field, and the tokens
 * that came back from Meta stay in the encrypted draft on the server until
 * the selection is submitted.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/layout/empty-state';
import { cancelSocialConnect, completeSocialConnect } from '@/features/social/actions';
import { PlatformIcon } from '@/components/social/platform-icon';
import { PLATFORM_LABELS, type SocialCandidate } from '@/lib/social/types';

function keyOf(candidate: SocialCandidate): string {
  return `${candidate.platform}:${candidate.platformAccountId}`;
}

export function ChooseAccountsClient({
  draftId,
  candidates,
}: {
  draftId: string;
  candidates: SocialCandidate[];
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  /* Everything usable starts ticked: the merchant has just said yes on
   * Facebook's own dialog, so connecting what they authorised is the
   * expected outcome — unticking is the exception. */
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(candidates.filter((c) => !c.unavailableReason).map(keyOf)),
  );

  const selectable = candidates.filter((c) => !c.unavailableReason);

  function toggle(candidate: SocialCandidate) {
    setSelected((current) => {
      const next = new Set(current);
      const key = keyOf(candidate);
      if (next.has(key)) {
        next.delete(key);
        /* An Instagram account posts through its Page's permission, so it
         * can't be connected on its own. Unticking the Page unticks it. */
        if (candidate.platform === 'FACEBOOK_PAGE') {
          for (const child of candidates) {
            if (child.parentAccountId === candidate.platformAccountId) next.delete(keyOf(child));
          }
        }
      } else {
        next.add(key);
        if (candidate.parentAccountId) {
          const parent = candidates.find(
            (c) => c.platform === 'FACEBOOK_PAGE' && c.platformAccountId === candidate.parentAccountId,
          );
          if (parent && !parent.unavailableReason) next.add(keyOf(parent));
        }
      }
      return next;
    });
  }

  async function handleSubmit() {
    const selections = candidates
      .filter((candidate) => selected.has(keyOf(candidate)) && !candidate.unavailableReason)
      .map((candidate) => ({ platform: candidate.platform, platformAccountId: candidate.platformAccountId }));

    if (selections.length === 0) {
      toast.error('Choose at least one account to connect');
      return;
    }

    setPending(true);
    const result = await completeSocialConnect({ draftId, selections });
    setPending(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    const count = result.data.connected.length;
    toast.success(count === 1 ? `${result.data.connected[0].accountName} connected` : `${count} accounts connected`);
    router.push('/social');
    router.refresh();
  }

  async function handleCancel() {
    setPending(true);
    await cancelSocialConnect(draftId);
    router.push('/social');
    router.refresh();
  }

  if (candidates.length === 0) {
    return (
      <EmptyState
        title="Facebook didn’t return any accounts"
        description="Your Facebook account doesn’t administer a Page yet. Create a Facebook Page for your store, then connect again."
      />
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">
        These are the accounts your Facebook sign-in gave us access to. Tick the ones this store should post from.
        {selectable.length === 0 && ' None of them can be used yet — see the reasons below.'}
      </p>

      <ul className="space-y-2">
        {candidates.map((candidate) => {
          const key = keyOf(candidate);
          const disabled = Boolean(candidate.unavailableReason) || pending;
          const inputId = `account-${key.replace(/[^a-zA-Z0-9]/g, '-')}`;

          return (
            <li key={key}>
              <label
                htmlFor={inputId}
                className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50'
                } ${candidate.parentAccountId ? 'ml-6' : ''}`}
              >
                <CheckboxRoot
                  id={inputId}
                  className="mt-0.5"
                  checked={selected.has(key)}
                  disabled={disabled}
                  onCheckedChange={() => toggle(candidate)}
                />
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <PlatformIcon platform={candidate.platform} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{candidate.accountName}</span>
                    <Badge variant="muted">{PLATFORM_LABELS[candidate.platform]}</Badge>
                    {candidate.alreadyConnected && <Badge variant="info">Already connected</Badge>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {candidate.username ? `@${candidate.username}` : '—'}
                  </span>
                  {candidate.unavailableReason && (
                    <span className="mt-1 block text-xs text-muted-foreground">{candidate.unavailableReason}</span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button onClick={handleSubmit} disabled={pending || selected.size === 0}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Connect {selected.size === 1 ? 'account' : `${selected.size} accounts`}
        </Button>
        <Button variant="outline" onClick={handleCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
