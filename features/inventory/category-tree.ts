// features/inventory/category-tree.ts
// Pure rules for the category tree, shared by the server actions (which
// enforce them) and the admin UI (which explains them before a user hits an
// error). No Prisma, no 'use server' — so it's importable anywhere and
// unit-testable.
//
// Categories are also the online store's department tree. The storefront
// addresses a category by its slug path (/c/fashion/women/skirts) and its
// navigation renders exactly three levels (bar → column → link), so the tree
// is capped at MAX_CATEGORY_DEPTH levels.

export const MAX_CATEGORY_DEPTH = 3;

/** "Goes well with" categories per category — a rail shows about four aisles. */
export const MAX_COMPANIONS = 4;

export type CategoryNodeInput = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
};

export type CategoryTreeNode<T extends CategoryNodeInput> = T & {
  /** 0 = top level */
  depth: number;
  /** names from the root down to this node, inclusive */
  namePath: string[];
  /** slugs from the root down to this node, inclusive */
  slugPath: string[];
  children: CategoryTreeNode<T>[];
};

/** "Men's T‑Shirts & Polos" → "mens-t-shirts-polos" */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'category';
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Siblings ordered the way both the admin and storefront show them. */
export function compareSiblings(a: CategoryNodeInput, b: CategoryNodeInput): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/**
 * Builds the nested tree. Rows whose parent is missing (shouldn't happen, but
 * `onDelete: SetNull` history or a bad import could leave one) are promoted to
 * the top level rather than silently disappearing.
 */
export function buildCategoryTree<T extends CategoryNodeInput>(rows: T[]): CategoryTreeNode<T>[] {
  const ids = new Set(rows.map((r) => r.id));
  const byParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }

  const seen = new Set<string>();
  const build = (
    parentId: string | null,
    depth: number,
    namePath: string[],
    slugPath: string[],
  ): CategoryTreeNode<T>[] =>
    (byParent.get(parentId) ?? [])
      .filter((row) => !seen.has(row.id)) // guards against a cycle in bad data
      .sort(compareSiblings)
      .map((row) => {
        seen.add(row.id);
        const names = [...namePath, row.name];
        const slugs = [...slugPath, row.slug];
        return {
          ...row,
          depth,
          namePath: names,
          slugPath: slugs,
          children: build(row.id, depth + 1, names, slugs),
        };
      });

  return build(null, 0, [], []);
}

/** Depth-first, in display order. */
export function flattenCategoryTree<T extends CategoryNodeInput>(
  tree: CategoryTreeNode<T>[],
): CategoryTreeNode<T>[] {
  return tree.flatMap((node) => [node, ...flattenCategoryTree(node.children)]);
}

/** Every id below `id` (not including it). */
export function descendantIds(rows: CategoryNodeInput[], id: string): Set<string> {
  const result = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    for (const row of rows) {
      if (row.parentId === current && !result.has(row.id)) {
        result.add(row.id);
        stack.push(row.id);
      }
    }
  }
  return result;
}

/** 0-based depth of `id`, i.e. how many ancestors it has. */
export function depthOf(rows: CategoryNodeInput[], id: string): number {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let depth = 0;
  let current = byId.get(id);
  const visited = new Set<string>();
  while (current?.parentId && byId.has(current.parentId) && !visited.has(current.id)) {
    visited.add(current.id);
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

/** Levels in the subtree rooted at `id`, counting itself (a leaf is 1). */
export function subtreeHeight(rows: CategoryNodeInput[], id: string): number {
  const children = rows.filter((r) => r.parentId === id);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((c) => subtreeHeight(rows, c.id)));
}

/**
 * Why `categoryId` (or a new category, when null) can't live under
 * `parentId` — or null if it can. Plain-language, shown to users as-is.
 */
export function parentProblem(
  rows: CategoryNodeInput[],
  categoryId: string | null,
  parentId: string | null,
): string | null {
  if (!parentId) return null;

  if (!rows.some((r) => r.id === parentId)) return 'The parent category no longer exists.';

  if (categoryId) {
    if (parentId === categoryId) return 'A category can’t be placed inside itself.';
    if (descendantIds(rows, categoryId).has(parentId)) {
      return 'A category can’t be placed inside one of its own subcategories.';
    }
  }

  const height = categoryId ? subtreeHeight(rows, categoryId) : 1;
  if (depthOf(rows, parentId) + 1 + height > MAX_CATEGORY_DEPTH) {
    return categoryId && height > 1
      ? `This would make the tree deeper than ${MAX_CATEGORY_DEPTH} levels, counting its subcategories.`
      : `Categories can only be ${MAX_CATEGORY_DEPTH} levels deep.`;
  }
  return null;
}

/** `base`, or `base-2`, `base-3`… — whichever isn't in `taken`. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Storefront path for a category, e.g. /c/fashion/women/skirts */
export function storefrontCategoryPath(slugPath: string[]): string {
  return `/c/${slugPath.join('/')}`;
}
