'use client';

/*
 * "What you hear about" (ROADMAP 18.6) — on Settings → Notifications and the
 * console's notification settings. One row per category that can reach this
 * person; a switch for email and one for alerts on their devices. The list
 * (the bell) always gets everything, so nothing here can make a notification
 * disappear entirely. Saved one switch at a time, straight away.
 */
import * as React from 'react';
import { toast } from 'sonner';
import { SwitchRoot } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { setMyNotificationPreference, setPlatformNotificationPreference } from '@/features/notifications/actions';
import type { ChannelGroup, PreferenceCell, PreferenceRow } from '@/lib/notifications/view';

export function PreferenceGrid({ rows: initial, scope }: { rows: PreferenceRow[]; scope: 'staff' | 'platform' }) {
  const [rows, setRows] = React.useState(initial);
  const [saving, setSaving] = React.useState<string | null>(null);
  const showEmail = rows.some((r) => r.email);

  async function change(category: string, group: ChannelGroup, on: boolean) {
    const key = `${category}:${group}`;
    const before = rows;
    setRows((list) => list.map((r) => (r.category === category && r[group] ? { ...r, [group]: { ...r[group]!, on } } : r)));
    setSaving(key);
    const save = scope === 'platform' ? setPlatformNotificationPreference : setMyNotificationPreference;
    const result = await save(category, group, on).catch(() => ({ success: false as const, error: 'We couldn’t save that. Please try again.' }));
    setSaving(null);
    if (!result.success) {
      setRows(before);
      toast.error(result.error);
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">There’s nothing for you to choose here yet.</p>;
  }

  return (
    <section aria-labelledby="what-you-hear" className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 id="what-you-hear" className="text-sm font-semibold">
          What you hear about
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Everything always shows on the bell. Choose what else reaches you by email, and as alerts on your devices.
        </p>
      </div>
      <TableWrapper className="rounded-none border-0">
        <Table>
          <TableHead>
            <TableRow>
              <TableColumnHeader>Notifications about</TableColumnHeader>
              {showEmail && <TableColumnHeader className="w-28 text-center">Email</TableColumnHeader>}
              <TableColumnHeader className="w-32 text-center">Device alerts</TableColumnHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.category}>
                <TableCell>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.about}</p>
                </TableCell>
                {showEmail && (
                  <TableCell className="text-center">
                    <Choice cell={row.email} label={`Email about ${row.label.toLowerCase()}`} busy={saving === `${row.category}:email`} onChange={(on) => void change(row.category, 'email', on)} />
                  </TableCell>
                )}
                <TableCell className="text-center">
                  <Choice cell={row.push} label={`Device alerts about ${row.label.toLowerCase()}`} busy={saving === `${row.category}:push`} onChange={(on) => void change(row.category, 'push', on)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>
    </section>
  );
}

function Choice({ cell, label, busy, onChange }: { cell: PreferenceCell | null; label: string; busy: boolean; onChange: (on: boolean) => void }) {
  if (!cell) return <span className="text-xs text-muted-foreground">—</span>;
  if (cell.kind === 'required') return <span className="text-xs text-muted-foreground">Always</span>;
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <SwitchRoot checked={cell.on} onCheckedChange={onChange} disabled={busy} aria-label={label} />
      {cell.kind === 'digest' && cell.on && <span className="text-[11px] text-muted-foreground">Daily summary</span>}
    </span>
  );
}
