'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  FolderPlus,
  FolderTree,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { moveCategory, updateCategory, type CategoryWithCounts } from '@/features/inventory/actions';
import {
  MAX_CATEGORY_DEPTH,
  buildCategoryTree,
  storefrontCategoryPath,
  type CategoryTreeNode,
} from '@/features/inventory/category-tree';
import { CategorySheet } from './CategorySheet';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';

type Node = Omit<CategoryTreeNode<CategoryWithCounts>, 'children'> & {
  children: Node[];
  totalItems: number;
  hiddenByParent: boolean;
};

type CategoriesPageClientProps = {
  categories: CategoryWithCounts[];
  canManage: boolean;
};

/** Adds rolled-up item counts and inherited visibility — the storefront shows
 *  a department's products including everything below it, and hides a
 *  subtree whose parent is hidden. */
function decorate(nodes: CategoryTreeNode<CategoryWithCounts>[], parentHidden = false): Node[] {
  return nodes.map((node) => {
    const children = decorate(node.children, parentHidden || !node.isVisible);
    return {
      ...node,
      children,
      hiddenByParent: parentHidden,
      totalItems: node.itemCount + children.reduce((sum, c) => sum + c.totalItems, 0),
    };
  });
}

/** Keeps nodes whose name matches, plus their ancestors for context. */
function filterTree(nodes: Node[], query: string): Node[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, q);
    return node.name.toLowerCase().includes(q) || children.length ? [{ ...node, children }] : [];
  });
}

function countNodes(nodes: Node[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

export function CategoriesPageClient({ categories, canManage }: CategoriesPageClientProps) {
  const router = useRouter();
  const tree = React.useMemo(() => decorate(buildCategoryTree(categories)), [categories]);

  const [query, setQuery] = React.useState('');
  // Small trees start fully open; big ones start at the top level so the page stays scannable.
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(categories.length <= 40 ? categories.map((c) => c.id) : []),
  );
  // Target outlives `sheetOpen` so the sheet's title doesn't flip mid close-animation.
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [sheetTarget, setSheetTarget] = React.useState<{ editing: CategoryWithCounts | null; parentId: string | null }>({
    editing: null,
    parentId: null,
  });
  const [deleting, setDeleting] = React.useState<Node | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const visibleTree = filterTree(tree, query);
  const searching = query.trim().length > 0;
  const matchCount = searching ? countNodes(visibleTree) : 0;

  function setSheet(target: { editing: CategoryWithCounts | null; parentId: string | null }) {
    setSheetTarget(target);
    setSheetOpen(true);
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runRowAction(node: Node, action: () => Promise<{ success: boolean; error?: string }>, success?: string) {
    setBusyId(node.id);
    const result = await action();
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error ?? 'Something went wrong');
      return;
    }
    if (success) toast.success(success);
    router.refresh();
  }

  function toggleVisibility(node: Node) {
    return runRowAction(
      node,
      () =>
        updateCategory(node.id, {
          name: node.name,
          parentId: node.parentId,
          slug: node.slug,
          description: node.description ?? '',
          imageUrl: node.imageUrl ?? '',
          isVisible: !node.isVisible,
          isFeatured: node.isFeatured,
        }),
      node.isVisible ? `“${node.name}” is now hidden from your online store` : `“${node.name}” is now shown in your online store`,
    );
  }

  function renderRows(nodes: Node[]): React.ReactNode {
    return nodes.map((node, index) => {
      const hasChildren = node.children.length > 0;
      const isOpen = searching || expanded.has(node.id);
      const canAddChild = node.depth < MAX_CATEGORY_DEPTH - 1;
      const hidden = !node.isVisible || node.hiddenByParent;

      return (
        <li key={node.id} role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={false}>
          <div
            className={cn(
              'group flex min-h-14 items-center gap-2 border-b py-2 pr-2 pl-[calc(8px+var(--depth)*14px)] transition-colors hover:bg-muted/40 sm:pr-3 sm:pl-[calc(12px+var(--depth)*28px)]',
              busyId === node.id && 'opacity-60',
            )}
            style={{ '--depth': node.depth } as React.CSSProperties}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggle(node.id)}
                aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} />
              </button>
            ) : (
              <span className="size-7 shrink-0" />
            )}

            <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
              {node.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- merchant-supplied host
                <img src={node.imageUrl} alt="" className="size-full object-cover" />
              ) : (
                <FolderTree className="size-4" />
              )}
            </div>

            <button
              type="button"
              className="min-w-0 flex-1 text-left disabled:cursor-default"
              onClick={() => canManage && setSheet({ editing: node, parentId: node.parentId })}
              disabled={!canManage}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={cn('truncate text-sm font-medium', hidden ? 'text-muted-foreground' : 'text-foreground')}>
                  {node.name}
                </span>
                {node.isFeatured && node.depth === 0 && (
                  <Badge variant="info">
                    <Star className="size-3" />
                    Featured
                  </Badge>
                )}
                {!node.isVisible && (
                  <Badge variant="muted">
                    <EyeOff className="size-3" />
                    Hidden online
                  </Badge>
                )}
                {node.isVisible && node.hiddenByParent && (
                  <Badge variant="muted" title="A category above this one is hidden">
                    <EyeOff className="size-3" />
                    Hidden by parent
                  </Badge>
                )}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                {storefrontCategoryPath(node.slugPath)}
              </span>
            </button>

            <span
              className="hidden shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block"
              title={hasChildren ? `${node.itemCount} filed directly in ${node.name}` : undefined}
            >
              {node.totalItems} item{node.totalItems === 1 ? '' : 's'}
              {hasChildren && node.itemCount !== node.totalItems && (
                <span className="block text-[11px]">incl. subcategories</span>
              )}
            </span>

            {canManage && (
              <div className="flex shrink-0 items-center gap-0.5">
                {canAddChild && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Add a subcategory to ${node.name}`}
                    title="Add subcategory"
                    onClick={() => setSheet({ editing: null, parentId: node.id })}
                  >
                    <FolderPlus className="size-3.5" />
                  </Button>
                )}
                <DropdownMenuRoot>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${node.name}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => setSheet({ editing: node, parentId: node.parentId })}>
                      <Pencil />
                      Edit
                    </DropdownMenuItem>
                    {canAddChild && (
                      <DropdownMenuItem onSelect={() => setSheet({ editing: null, parentId: node.id })}>
                        <FolderPlus />
                        Add subcategory
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => toggleVisibility(node)}>
                      {node.isVisible ? <EyeOff /> : <Eye />}
                      {node.isVisible ? 'Hide from online store' : 'Show in online store'}
                    </DropdownMenuItem>
                    {!searching && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={index === 0}
                          onSelect={() => runRowAction(node, () => moveCategory(node.id, 'up'))}
                        >
                          <ArrowUp />
                          Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === nodes.length - 1}
                          onSelect={() => runRowAction(node, () => moveCategory(node.id, 'down'))}
                        >
                          <ArrowDown />
                          Move down
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setDeleting(node)}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuRoot>
              </div>
            )}
          </div>

          {hasChildren && isOpen && <ul role="group">{renderRows(node.children)}</ul>}
        </li>
      );
    });
  }

  return (
    <>
      <PageHeader
        title="Categories"
        description="Group your products. These also become the departments customers browse in your online store."
        actions={
          canManage && categories.length > 0 ? (
            <Button size="sm" onClick={() => setSheet({ editing: null, parentId: null })}>
              <Plus className="size-3.5" />
              New category
            </Button>
          ) : undefined
        }
      />

      {categories.length > 0 && (
        <PageToolbar>
          <div className="w-full sm:w-72">
            <Input
              aria-label="Find a category"
              placeholder="Find a category…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              startAdornment={<Search className="size-3.5" />}
              endAdornment={
                query ? (
                  <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                    <X className="size-3.5" />
                  </button>
                ) : undefined
              }
            />
          </div>
          {!searching && categories.some((c) => c.parentId) && (
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set(categories.map((c) => c.id)))}>
                Expand all
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>
                Collapse all
              </Button>
            </div>
          )}
          {searching && (
            <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
              {matchCount === 0 ? 'No matches' : `Showing ${matchCount} categor${matchCount === 1 ? 'y' : 'ies'}`}
            </span>
          )}
        </PageToolbar>
      )}

      <PageBody>
        {categories.length === 0 ? (
          <div className="mx-auto flex max-w-lg flex-col items-center rounded-lg border border-dashed px-6 py-14 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <FolderTree className="size-5" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-foreground">Organise your catalog</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Categories group similar products, like <span className="text-foreground">Fashion › Women › Skirts</span>.
              Customers use them to browse your online store, and you can use them to filter stock and reports.
            </p>
            {canManage ? (
              <Button size="sm" className="mt-4" onClick={() => setSheet({ editing: null, parentId: null })}>
                <Plus className="size-3.5" />
                Create your first category
              </Button>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">Ask an admin to set up categories.</p>
            )}
          </div>
        ) : visibleTree.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">No categories match “{query.trim()}”</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setQuery('')}>
              Clear search
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
            <ul role="tree" aria-label="Categories" className="-mb-px">
              {renderRows(visibleTree)}
            </ul>
          </div>
        )}
      </PageBody>

      {canManage && (
        <>
          <CategorySheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            categories={categories}
            editing={sheetTarget.editing}
            defaultParentId={sheetTarget.parentId}
          />
          <DeleteCategoryDialog
            category={deleting}
            childCount={deleting ? categories.filter((c) => c.parentId === deleting.id).length : 0}
            onOpenChange={(open) => !open && setDeleting(null)}
          />
        </>
      )}
    </>
  );
}
