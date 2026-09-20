/*
 * lib/storefront/pages/format.ts
 *
 * The small formatting language store pages are written in, and its parser.
 *
 * Merchants are shop owners, not web developers, so this is deliberately
 * tiny — the handful of things a policy, FAQ or size guide actually needs:
 *
 *   ## Heading            (# and ## are section headings, ### a sub-heading)
 *   - a bulleted item     (or * item)
 *   1. a numbered item
 *   **bold words**
 *   [link text](https://…) — also /relative, mailto: and tel:
 *   | Size | Chest |       a table; the first row is the header
 *
 * Blank lines separate paragraphs; a single line break is kept (addresses,
 * opening hours). Bare web and email addresses become links.
 *
 * The parser returns data, never HTML: the storefront renders it as React
 * elements, so nothing a merchant types can become markup or script. A link
 * whose address isn't one of the safe kinds above is shown as plain text.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'link'; href: string; external: boolean; children: Inline[] };

export type Block =
  | { type: 'heading'; level: 2 | 3; id: string; content: Inline[] }
  | { type: 'paragraph'; lines: Inline[][] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; head: Inline[][]; rows: Inline[][][] };

/** How long a page may be. Generous — a full set of terms fits many times over. */
export const PAGE_BODY_MAX = 50_000;

/* ---------------- links ---------------- */

/**
 * The address to link to, or null when it isn't safe to. Web addresses,
 * email, phone, and paths within the store — never `javascript:`, `data:`
 * or a protocol-relative `//host`.
 */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim();
  if (!href || /\s/.test(href)) return null;
  if (href.startsWith('/') && !href.startsWith('//')) return { href, external: false };
  if (href.startsWith('#')) return { href, external: false };
  if (/^https?:\/\/[^/\s]+/i.test(href)) return { href, external: true };
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(href)) return { href, external: false };
  if (/^tel:\+?[\d\s().-]{3,}$/i.test(href)) return { href, external: false };
  return null;
}

/* ---------------- inline ---------------- */

const BARE_LINK = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;

/** Plain text with bare web and email addresses turned into links. */
function autolink(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(BARE_LINK)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ type: 'text', text: text.slice(last, start) });
    const [whole, url, email] = match;
    const target = safeHref(url ? url : `mailto:${email}`);
    out.push(
      target
        ? { type: 'link', href: target.href, external: target.external, children: [{ type: 'text', text: whole }] }
        : { type: 'text', text: whole },
    );
    last = start + whole.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** `[text](href)` and `**bold**`, then bare addresses in whatever is left. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+?)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) out.push(...autolink(text.slice(last, start)));
    const [whole, linkText, linkHref, bold] = match;
    if (bold !== undefined) {
      out.push({ type: 'strong', children: parseInline(bold) });
    } else {
      const target = safeHref(linkHref);
      // An unsafe address keeps its words and loses the link.
      const children = parseInline(linkText).map((n) => (n.type === 'link' ? n.children : [n])).flat();
      out.push(target ? { type: 'link', href: target.href, external: target.external, children } : { type: 'text', text: linkText });
    }
    last = start + whole.length;
  }
  if (last < text.length) out.push(...autolink(text.slice(last)));
  return mergeText(out);
}

function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (node.type === 'text' && prev?.type === 'text') prev.text += node.text;
    else if (node.type !== 'text' || node.text) out.push(node);
  }
  return out;
}

export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.text : inlineText(n.children))).join('');
}

/* ---------------- blocks ---------------- */

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function anchorFor(text: string, used: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section';
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  return seen ? `${base}-${seen + 1}` : base;
}

export function parsePageBody(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const anchors = new Map<string, number>();
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', lines: paragraph.map((line) => parseInline(line.trim())) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line.trim());
    if (heading) {
      flush();
      const content = parseInline(heading[2]);
      blocks.push({
        type: 'heading',
        level: heading[1].length === 3 ? 3 : 2,
        id: anchorFor(inlineText(content), anchors),
        content,
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const itemPattern = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const match = itemPattern.exec(lines[i]);
        if (!match) break;
        items.push(parseInline(match[1].trim()));
        i++;
      }
      i--;
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (TABLE_ROW.test(line)) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        if (!TABLE_RULE.test(lines[i])) rows.push(cells(lines[i]));
        i++;
      }
      i--;
      if (!rows.length) continue;
      const [head, ...rest] = rows;
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (row: string[]) => [...row, ...Array(width - row.length).fill('')].map(parseInline);
      blocks.push({ type: 'table', head: pad(head), rows: rest.map(pad) });
      continue;
    }

    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Headings a long page can offer as "On this page" links. */
export function pageOutline(blocks: Block[]): { id: string; text: string }[] {
  return blocks
    .filter((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading' && b.level === 2)
    .map((b) => ({ id: b.id, text: inlineText(b.content) }));
}

/** The first words of the page as plain text, for a search-engine description. */
export function pageExcerpt(body: string, max = 160): string {
  const text = parsePageBody(body)
    .filter((b) => b.type === 'paragraph')
    .flatMap((b) => (b.type === 'paragraph' ? b.lines.map(inlineText) : []))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length)}…`;
}
