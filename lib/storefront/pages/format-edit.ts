/*
 * lib/storefront/pages/format-edit.ts
 *
 * What the formatting toolbar does to the text in the box. The text stays in
 * the small formatting language of ./format.ts (`**bold**`, `## Heading`,
 * `- item`, `1. item`, `[words](address)`), so the toolbar only types those
 * marks for the merchant — there is no hidden HTML and nothing the storefront
 * renders differently from what they could have typed themselves.
 *
 * Pure functions: text + selection in, text + selection out. The editor
 * component applies the result.
 */

export type TextEdit = { value: string; start: number; end: number };

export type LineFormat = 'heading' | 'bullet' | 'numbered';

const LINE_MARK = /^(\s*)(#{1,3}\s+|[-*•]\s+|\d{1,3}[.)]\s+)/;

const MARK_FOR: Record<LineFormat, RegExp> = {
  heading: /^#{1,3}\s+/,
  bullet: /^[-*•]\s+/,
  numbered: /^\d{1,3}[.)]\s+/,
};

/** Bold on or off for the selection; with nothing selected, a placeholder to type over. */
export function toggleBold(value: string, start: number, end: number): TextEdit {
  const selected = value.slice(start, end);

  // Already bold: the marks are just outside the selection, or part of it.
  if (value.slice(start - 2, start) === '**' && value.slice(end, end + 2) === '**') {
    return {
      value: value.slice(0, start - 2) + selected + value.slice(end + 2),
      start: start - 2,
      end: end - 2,
    };
  }
  if (selected.length >= 4 && selected.startsWith('**') && selected.endsWith('**')) {
    const inner = selected.slice(2, -2);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }

  if (!selected) {
    const placeholder = 'bold text';
    return {
      value: `${value.slice(0, start)}**${placeholder}**${value.slice(end)}`,
      start: start + 2,
      end: start + 2 + placeholder.length,
    };
  }

  // Keep surrounding spaces outside the marks: "** word**" isn't bold.
  const lead = selected.length - selected.trimStart().length;
  const trail = selected.length - selected.trimEnd().length;
  const core = selected.trim();
  if (!core) return { value, start, end };
  const s = start + lead;
  const e = end - trail;
  return {
    value: `${value.slice(0, s)}**${core}**${value.slice(e)}`,
    start: s + 2,
    end: s + 2 + core.length,
  };
}

/**
 * Heading, bulleted or numbered on every line the selection touches. If all
 * of them already have it, it's taken off; a line with another kind of mark
 * (a bullet turned into a number) swaps it.
 */
export function toggleLines(value: string, start: number, end: number, format: LineFormat): TextEdit {
  const blockStart = value.lastIndexOf('\n', start - 1) + 1;
  // A selection ending just after a line break doesn't include the next line.
  const endAt = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nextBreak = value.indexOf('\n', endAt);
  const blockEnd = nextBreak === -1 ? value.length : nextBreak;

  const lines = value.slice(blockStart, blockEnd).split('\n');
  const filled = lines.filter((line) => line.trim());
  const allHave = filled.length > 0 && filled.every((line) => MARK_FOR[format].test(line.trimStart()));

  let n = 0;
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    const bare = line.replace(LINE_MARK, '');
    if (allHave) return bare;
    n += 1;
    const mark = format === 'heading' ? '## ' : format === 'bullet' ? '- ' : `${n}. `;
    return mark + bare;
  });

  // A lone empty line still gets its mark, so there's somewhere to type.
  if (!filled.length && !allHave) {
    next[0] = (format === 'heading' ? '## ' : format === 'bullet' ? '- ' : '1. ') + next[0];
  }

  const replaced = next.join('\n');
  const out = value.slice(0, blockStart) + replaced + value.slice(blockEnd);

  if (start === end && lines.length === 1) {
    // Keep the cursor where it was in the words, not the marks.
    const shift = replaced.length - lines[0].length;
    const cursor = Math.max(blockStart, Math.min(blockStart + replaced.length, start + shift));
    return { value: out, start: cursor, end: cursor };
  }
  return { value: out, start: blockStart, end: blockStart + replaced.length };
}

/** A link around the selection, with the address part selected to paste over. */
export function insertLink(value: string, start: number, end: number): TextEdit {
  const words = value.slice(start, end).trim() || 'link text';
  const address = 'https://';
  const inserted = `[${words}](${address})`;
  const out = value.slice(0, start) + inserted + value.slice(end);
  const addrAt = start + words.length + 3;
  return { value: out, start: addrAt, end: addrAt + address.length };
}

/**
 * The part of `before` that changed to make `after`, so the editor can
 * replace just that stretch (and the browser's undo still works).
 */
export function changedRange(before: string, after: string): { from: number; to: number; text: string } {
  let from = 0;
  const max = Math.min(before.length, after.length);
  while (from < max && before[from] === after[from]) from++;
  let tailB = before.length;
  let tailA = after.length;
  while (tailB > from && tailA > from && before[tailB - 1] === after[tailA - 1]) {
    tailB--;
    tailA--;
  }
  return { from, to: tailB, text: after.slice(from, tailA) };
}
