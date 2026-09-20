/*
 * Renders a store page's text (lib/storefront/pages/format.ts) as elements.
 *
 * Shared by the storefront page and the admin editor's preview, so what the
 * merchant previews is what shoppers get. It uses only the generic theme
 * tokens (foreground, muted, border), which both the admin and the
 * storefront define — each surface keeps its own look without either
 * borrowing the other's tokens.
 *
 * No `dangerouslySetInnerHTML` anywhere: the parser hands over data, and
 * every string lands in the page as text.
 *
 * `preview` draws links without making them clickable — inside the admin a
 * store link like "/products" would lead somewhere else entirely.
 */
import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { Block, Inline } from '@/lib/storefront/pages/format';

const LINK_CLASS = 'font-medium text-foreground underline underline-offset-2 hover:opacity-80';

function Inlines({ nodes, preview }: { nodes: Inline[]; preview: boolean }) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.type === 'text') return <React.Fragment key={i}>{node.text}</React.Fragment>;
        if (node.type === 'strong') {
          return (
            <strong key={i} className="font-semibold text-foreground">
              <Inlines nodes={node.children} preview={preview} />
            </strong>
          );
        }
        const children = <Inlines nodes={node.children} preview={preview} />;
        if (preview) {
          return (
            <span key={i} className={LINK_CLASS} title={node.href}>
              {children}
            </span>
          );
        }
        if (node.external) {
          return (
            <a key={i} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className={LINK_CLASS}>
              {children}
            </a>
          );
        }
        if (node.href.startsWith('/')) {
          return (
            <Link key={i} href={node.href} className={LINK_CLASS}>
              {children}
            </Link>
          );
        }
        return (
          <a key={i} href={node.href} className={LINK_CLASS}>
            {children}
          </a>
        );
      })}
    </>
  );
}

export function PageBlocks({
  blocks,
  preview = false,
  className,
}: {
  blocks: Block[];
  preview?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-base', className)}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return block.level === 2 ? (
              <h2 key={i} id={block.id} className="scroll-mt-24 pt-4 text-lg font-semibold text-foreground sm:text-xl">
                <Inlines nodes={block.content} preview={preview} />
              </h2>
            ) : (
              <h3 key={i} id={block.id} className="scroll-mt-24 pt-2 text-base font-semibold text-foreground">
                <Inlines nodes={block.content} preview={preview} />
              </h3>
            );
          case 'paragraph':
            return (
              <p key={i}>
                {block.lines.map((line, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && <br />}
                    <Inlines nodes={line} preview={preview} />
                  </React.Fragment>
                ))}
              </p>
            );
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List key={i} className={cn('space-y-1.5 pl-5', block.ordered ? 'list-decimal' : 'list-disc')}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inlines nodes={item} preview={preview} />
                  </li>
                ))}
              </List>
            );
          }
          case 'table':
            return (
              <div key={i} className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-max border-collapse text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {block.head.map((cell, j) => (
                        <th key={j} scope="col" className="border-b px-3 py-2 text-left font-semibold text-foreground">
                          <Inlines nodes={cell} preview={preview} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j} className="border-b last:border-b-0">
                        {row.map((cell, k) => (
                          <td key={k} className="px-3 py-2 tabular-nums">
                            {cell.length ? <Inlines nodes={cell} preview={preview} /> : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
