'use client';

import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { csvFilename, toCsv, type CsvColumn } from '@/lib/csv';
import { inBusinessApp } from '@/lib/business-app/client';
import { shareFile } from '@/lib/business-app/share';

/**
 * Downloads what's on screen as a spreadsheet.
 *
 * Two shapes, because reports come in two kinds. Pass `rows` when the whole
 * report is already in the browser: there is no round trip and the file
 * matches exactly what the filters are showing. Pass `fetchRows` when the
 * list is paginated on the server — the file should then be every row the
 * filters match, not the twenty-five on screen, so the rows are fetched on
 * click.
 */
type BaseProps<T> = {
  columns: CsvColumn<T>[];
  /** report name, used for the filename */
  name: string;
  label?: string;
  disabled?: boolean;
};

type ExportCsvButtonProps<T> = BaseProps<T> &
  (
    | { rows: T[]; fetchRows?: never }
    | { rows?: never; fetchRows: () => Promise<{ success: true; data: T[] } | { success: false; error: string }> }
  );

export function ExportCsvButton<T>({
  rows,
  fetchRows,
  columns,
  name,
  label = 'Download CSV',
  disabled,
}: ExportCsvButtonProps<T>) {
  const [pending, setPending] = React.useState(false);

  async function save(data: T[]) {
    // The BOM is what makes Excel read the naira sign and accented names.
    const csv = `\uFEFF${toCsv(data, columns)}`;
    // The business app has no downloads: the phone's share sheet saves or sends the file (ROADMAP 19.4).
    if (inBusinessApp()) {
      if (!(await shareFile(csvFilename(name), csv))) toast.error('We couldn’t prepare the file. Please try again.');
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = csvFilename(name);
    link.click();
    URL.revokeObjectURL(url);
  }

  async function download() {
    if (!fetchRows) {
      await save(rows ?? []);
      return;
    }

    setPending(true);
    const result = await fetchRows();
    setPending(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    if (result.data.length === 0) {
      toast.error('There’s nothing to download with these filters');
      return;
    }
    await save(result.data);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={download}
      disabled={disabled || pending || (rows !== undefined && rows.length === 0)}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      {label}
    </Button>
  );
}
