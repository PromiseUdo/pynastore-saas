import { formatDate, formatRelativeTime } from '@/lib/format';
import { PLATFORM_AUDIT_LABELS, type PlatformAuditAction } from '@/lib/platform-audit';
import type { PlatformChange } from '@/features/platform/plans';

/** The latest changes to plans and billing settings, and who made them. */
export function RecentChanges({ changes }: { changes: PlatformChange[] | null }) {
  const now = new Date();
  return (
    <section aria-labelledby="changes-title" className="rounded-lg border bg-card shadow-xs">
      <div className="border-b px-5 py-3.5">
        <h2 id="changes-title" className="text-sm font-semibold text-foreground">
          Recent changes
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Changes to plans and billing settings, newest first.</p>
      </div>
      {changes === null ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Recent changes couldn’t be loaded. Refresh the page to try again.</p>
      ) : changes.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Nothing has been changed here yet.</p>
      ) : (
        <ul className="divide-y">
          {changes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-5 py-2.5 text-sm">
              <span className="text-foreground">
                {PLATFORM_AUDIT_LABELS[c.action as PlatformAuditAction] ?? 'Changed something'}
                {c.subject && <span className="font-medium"> · {c.subject}</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                {c.staffName ?? 'Someone no longer on the team'} ·{' '}
                <time dateTime={c.createdAt.toISOString()} title={formatDate(c.createdAt)}>
                  {formatRelativeTime(c.createdAt, now)}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
