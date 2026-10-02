/*
 * lib/data-rights/erase.ts
 *
 * Erase a workspace completely: the organization row and every row that
 * descends from it, in any table (ROADMAP 13.8). Used when a closed
 * workspace reaches the end of the retention period (./retention.ts).
 *
 * Rather than a hand-kept list of ~95 tables that would go stale with the
 * next migration, it reads the foreign keys from Postgres itself and deletes
 * children before parents. For each table it reaches:
 *   - children whose key is ON DELETE SET NULL / SET DEFAULT are left to
 *     Postgres;
 *   - children whose key would block the delete (RESTRICT / NO ACTION) or
 *     cascade are erased first, recursively, so a cascade can't be stopped by
 *     a RESTRICT one level down;
 *   - a self-reference (a product's parent, a merged customer) is cleared
 *     first when the column allows it.
 * A table with its own "organizationId" column is taken whole — every row of
 * this workspace, once — whichever way it was reached, which keeps the
 * statements shallow; a table without one (line items, say) is reached
 * through its parent. Only rows that descend from the organization are touched. Shared tables
 * (users, plans, the platform's own records) have no key pointing into a
 * workspace — tests/data-rights.test.ts asserts other workspaces and users
 * survive. Every statement is scoped by the organization's id, passed as a
 * parameter; table and column names come from the catalogue.
 *
 * Runs in the caller's transaction, so an erasure is all or nothing.
 */
import type { prisma } from '@/lib/prisma';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface ForeignKey {
  child: string;
  childColumn: string;
  childNullable: boolean;
  parent: string;
  parentColumn: string;
  /** a: no action, r: restrict, c: cascade, n: set null, d: set default */
  onDelete: 'a' | 'r' | 'c' | 'n' | 'd';
}

async function foreignKeys(tx: Tx): Promise<ForeignKey[]> {
  const rows = await tx.$queryRaw<
    { child: string; child_column: string; child_nullable: boolean; parent: string; parent_column: string; on_delete: string; columns: number }[]
  >`
    SELECT c.conrelid::regclass::text AS child,
           a.attname AS child_column,
           NOT a.attnotnull AS child_nullable,
           c.confrelid::regclass::text AS parent,
           af.attname AS parent_column,
           c.confdeltype::text AS on_delete,
           array_length(c.conkey, 1) AS columns
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`;
  if (rows.some((r) => r.columns !== 1)) {
    // Every key in this schema is single-column; one that isn't needs thought, not a guess.
    throw new Error('erase: a multi-column foreign key exists — update lib/data-rights/erase.ts');
  }
  return rows.map((r) => ({
    child: r.child,
    childColumn: r.child_column,
    childNullable: r.child_nullable,
    parent: r.parent,
    parentColumn: r.parent_column,
    onDelete: r.on_delete as ForeignKey['onDelete'],
  }));
}

/** Quote a catalogue identifier (regclass may already quote mixed-case names). */
function ident(name: string): string {
  return name.startsWith('"') ? name : `"${name.replace(/"/g, '""')}"`;
}

export interface EraseReport {
  /** rows deleted per table, counting only direct deletes (cascades aren't counted) */
  deleted: Record<string, number>;
}

/** Erase an organization and everything that descends from it. */
export async function eraseOrganization(tx: Tx, organizationId: string): Promise<EraseReport> {
  const keys = await foreignKeys(tx);
  const childrenOf = new Map<string, ForeignKey[]>();
  for (const k of keys) {
    const list = childrenOf.get(k.parent) ?? [];
    list.push(k);
    childrenOf.set(k.parent, list);
  }
  const scopedTables = new Set(
    (
      await tx.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'organizationId'`
    ).map((r) => r.table_name),
  );
  const erased = new Set<string>();
  const report: EraseReport = { deleted: {} };

  async function erase(table: string, reachedBy: string, path: string[]): Promise<void> {
    const scoped = scopedTables.has(table);
    if (scoped && erased.has(table)) return;
    const predicate = scoped ? `"organizationId" = $1` : reachedBy;
    for (const k of childrenOf.get(table) ?? []) {
      if (k.onDelete === 'n' || k.onDelete === 'd') continue; // Postgres clears these itself
      const inScope = `${ident(k.childColumn)} IN (SELECT ${ident(k.parentColumn)} FROM ${ident(table)} WHERE ${predicate})`;

      if (k.child === table || path.includes(k.child)) {
        // A loop back to a table on the way here: break it by clearing the reference.
        if (!k.childNullable) {
          throw new Error(`erase: cannot break the loop ${k.child}.${k.childColumn} → ${table}`);
        }
        await tx.$executeRawUnsafe(`UPDATE ${ident(k.child)} SET ${ident(k.childColumn)} = NULL WHERE ${inScope}`, organizationId);
        continue;
      }
      await erase(k.child, inScope, [...path, k.child]);
    }
    const count = await tx.$executeRawUnsafe(`DELETE FROM ${ident(table)} WHERE ${predicate}`, organizationId);
    if (count) report.deleted[table] = (report.deleted[table] ?? 0) + count;
    if (scoped) erased.add(table);
  }

  await erase('organizations', `"id" = $1`, ['organizations']);
  return report;
}
