'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Heart, Package, User } from 'lucide-react';
import {
  SheetRoot,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { useShopper } from '@/lib/storefront/context';
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';
import type { NavItem } from '@/lib/storefront/nav-types';
import { cn } from '@/lib/utils';

/** A single node in the drill-in menu tree. */
interface Node {
  id: string;
  name: string;
  href: string;
  /** shown as the header title + "Shop all" target once drilled into */
  children?: Node[];
  sale?: boolean;
}

interface Level {
  title: string;
  allHref?: string;
  nodes: Node[];
}

function buildTree(items: NavItem[]): Node[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    href: item.href,
    sale: item.highlight === 'sale',
    children: item.columns.length
      ? item.columns.map((col) => ({
          id: col.id,
          name: col.name,
          href: col.href,
          children: col.links.length
            ? col.links.map((l) => ({ id: l.id, name: l.name, href: l.href }))
            : undefined,
        }))
      : undefined,
  }));
}

export function MobileMenu({ items }: { items: NavItem[] }) {
  const overlay = useUIStore((s) => s.overlay);
  const close = useUIStore((s) => s.close);
  const open = overlay === 'menu';
  const pathname = usePublicPathname();
  const shopper = useShopper();

  const root = React.useMemo<Level>(() => ({ title: 'Menu', nodes: buildTree(items) }), [items]);
  const [stack, setStack] = React.useState<Level[]>([root]);
  const current = stack[stack.length - 1];

  React.useEffect(() => {
    if (!open) setStack([root]);
  }, [open, root]);
  React.useEffect(() => {
    close();
  }, [pathname, close]);

  const push = (node: Node) => {
    if (!node.children?.length) return;
    setStack((s) => [...s, { title: node.name, allHref: node.href, nodes: node.children! }]);
  };
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  return (
    <SheetRoot open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="left" className="w-[86vw] max-w-sm p-0">
        <SheetHeader className="flex-row items-center gap-2">
          {stack.length > 1 && (
            <button onClick={pop} className="-ml-1 rounded-md p-1.5 hover:bg-accent" aria-label="Back">
              <ChevronLeft className="size-5" />
            </button>
          )}
          <SheetTitle>{current.title}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {current.allHref && (
            <Link
              href={current.allHref}
              onClick={close}
              className="flex items-center justify-between border-b px-5 py-3.5 text-sm font-semibold text-brand"
            >
              Shop all {current.title}
              <ChevronRight className="size-4" />
            </Link>
          )}

          <ul>
            {current.nodes.map((node) => {
              const drill = Boolean(node.children?.length);
              const label = <span className={cn(node.sale && 'font-medium text-sale')}>{node.name}</span>;
              return (
                <li key={node.id} className="border-b border-border/70">
                  {drill ? (
                    <button
                      onClick={() => push(node)}
                      className="flex w-full items-center justify-between px-5 py-3.5 text-left text-sm"
                    >
                      {label}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                  ) : (
                    <Link
                      href={node.href}
                      onClick={close}
                      className="flex items-center justify-between px-5 py-3.5 text-sm"
                    >
                      {label}
                      <ChevronRight className="size-4 text-muted-foreground/40" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>

          {stack.length === 1 && (
            <div className="space-y-1 px-5 py-5">
              <Link
                href={shopper ? '/account' : '/account/sign-in'}
                onClick={close}
                className="flex items-center gap-3 py-2.5 text-sm"
              >
                <User className="size-4 text-muted-foreground" />
                {shopper ? `Hi, ${shopper.firstName}` : 'Sign in or create an account'}
              </Link>
              <Link
                href={shopper ? '/account/orders' : '/track-order'}
                onClick={close}
                className="flex items-center gap-3 py-2.5 text-sm"
              >
                <Package className="size-4 text-muted-foreground" /> Orders &amp; tracking
              </Link>
              <Link href="/wishlist" onClick={close} className="flex items-center gap-3 py-2.5 text-sm">
                <Heart className="size-4 text-muted-foreground" /> Wishlist
              </Link>
            </div>
          )}
        </div>
      </SheetContent>
    </SheetRoot>
  );
}
