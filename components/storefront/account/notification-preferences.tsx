'use client';

/*
 * "What you hear about" for a shopper (ROADMAP 18.6), on their account's
 * Notifications page: their orders and the store's replies, by email and on
 * their devices. The list on this page always gets everything; emails about
 * their account's security (a password reset, a new sign-in email) are
 * always sent and aren't a choice.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { setShopperNotificationPreferenceAction } from '@/features/shop-account/notification-actions';
import type { ChannelGroup, PreferenceCell, PreferenceRow } from '@/lib/notifications/view';

export function ShopperNotificationPreferences({ rows: initial }: { rows: PreferenceRow[] }) {
  const [rows, setRows] = React.useState(initial);
  const [failed, setFailed] = React.useState(false);

  async function change(category: string, group: ChannelGroup, on: boolean) {
    const before = rows;
    setFailed(false);
    setRows((list) => list.map((r) => (r.category === category && r[group] ? { ...r, [group]: { ...r[group]!, on } } : r)));
    if (!(await setShopperNotificationPreferenceAction(category, group, on).catch(() => false))) {
      setRows(before);
      setFailed(true);
    }
  }

  return (
    <section aria-labelledby="shopper-preferences" className="mt-8">
      <h2 id="shopper-preferences" className="font-display text-lg font-semibold">
        What you hear about
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Everything always shows on this page. Choose what else reaches you.</p>
      {failed && <p className="mt-2 text-sm text-destructive">That didn’t save. Please try again.</p>}
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {rows.map((row) => (
          <li key={row.category} className="px-4 py-3">
            <p className="font-medium">{row.label}</p>
            <p className="text-sm text-muted-foreground">{row.about}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Toggle cell={row.email} label="Email" onChange={(on) => void change(row.category, 'email', on)} />
              <Toggle cell={row.push} label="Notifications on your devices" onChange={(on) => void change(row.category, 'push', on)} />
            </div>
          </li>
        ))}
        <li className="px-4 py-3">
          <p className="font-medium">Your account’s security</p>
          <p className="text-sm text-muted-foreground">Password resets and changes to your email address. Always sent by email.</p>
        </li>
      </ul>
    </section>
  );
}

function Toggle({ cell, label, onChange }: { cell: PreferenceCell | null; label: string; onChange: (on: boolean) => void }) {
  if (!cell || cell.kind === 'required') return null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={cell.on}
      onClick={() => onChange(!cell.on)}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-[var(--sf-radius-button,999px)] border px-3 text-sm font-medium transition-colors',
        cell.on ? 'border-brand bg-brand text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-brand hover:text-brand',
      )}
    >
      <span aria-hidden className={cn('size-2 rounded-full', cell.on ? 'bg-primary-foreground' : 'bg-muted-foreground/50')} />
      {label}: {cell.on ? 'on' : 'off'}
    </button>
  );
}
