'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { csvFilename, toCsv, type CsvColumn } from '@/lib/csv';

/**
 * Downloads what's on screen as a spreadsheet. The rows are already in the
 * browser, so there's no round trip — and the file matches exactly what the
 * filters are showing.
 */
export function ExportCsvButton<T>({
  rows,
  columns,
  name,
  label = 'Download CSV',
}: {
  rows: T[];
  columns: CsvColumn<T>[];
  /** report name, used for the filename */
  name: string;
  label?: string;
}) {
  function download() {
    const blob = new Blob([`﻿${toCsv(rows, columns)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = csvFilename(name);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={download} disabled={rows.length === 0}>
      <Download className="size-3.5" />
      {label}
    </Button>
  );
}
