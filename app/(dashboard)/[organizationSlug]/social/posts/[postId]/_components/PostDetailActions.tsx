'use client';

/*
 * Retry and discard, for one post.
 *
 * Both reuse the Phase 2 publishing service through the existing server
 * actions — there is no second publish path here, and nothing in this
 * component talks to Meta. A retry is only offered for a post that never
 * went out; a published post has nothing to retry and must not be
 * re-published by a stray click.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { discardSocialPost, retrySocialPost } from '@/features/social/posts';
import type { SocialPostStatus } from '@/lib/social/types';

export function PostDetailActions({
  postId,
  status,
  label,
}: {
  postId: string;
  status: SocialPostStatus;
  label: string;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  // Only a post that never went out.
  const retryable = status === 'FAILED' || status === 'DRAFT';
  if (!retryable) return null;

  async function handleRetry() {
    setRetrying(true);
    const result = await retrySocialPost(postId);
    setRetrying(false);

    if (!result.success) {
      toast.error(result.error);
      router.refresh();
      return;
    }
    toast.success(`Published to ${result.data.accountName}`);
    router.refresh();
  }

  async function handleDiscard() {
    setPending(true);
    const result = await discardSocialPost(postId);
    setPending(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Post removed from history');
    router.push('/social/posts');
    router.refresh();
  }

  return (
    <>
      <Button size="sm" onClick={handleRetry} disabled={retrying || pending}>
        {retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {status === 'DRAFT' ? 'Publish now' : 'Try again'}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
        disabled={retrying || pending}
        aria-label={`Remove ${label} from history`}
      >
        <Trash2 className="size-4" />
        Remove
      </Button>

      <AlertDialogRoot open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this post from your history?</AlertDialogTitle>
            <AlertDialogDescription>
              This only forgets MansaaS’s record of{' '}
              {status === 'DRAFT' ? 'this unsent draft' : 'this failed attempt'}. Nothing is deleted from Facebook or
              Instagram, and you won’t be able to retry it afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDiscard} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Remove from history
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </>
  );
}
