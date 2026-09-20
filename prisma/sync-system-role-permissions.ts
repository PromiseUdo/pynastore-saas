/*
 * Sync script — run after adding a permission to lib/permissions.ts.
 *
 * Roles store their permissions as a snapshot taken when the organization was
 * created, so a permission added to the app later never reaches existing
 * stores — and nobody there can grant it, because staff can only grant
 * permissions they already hold. This adds, for every organization:
 *
 *   - to the Owner and Admin system roles: every permission the ORG'S OWNER
 *     role doesn't have yet. If even the Owner lacks it, it's a permission the
 *     app added later, not one a merchant chose to take away — so a merchant's
 *     deliberate trimming of their Admin role is left alone.
 *   - to other system roles (Warehouse Manager, …): the same new permissions,
 *     but only those that role's definition in SYSTEM_ROLES includes.
 *
 * Missing Permission rows are created first. Safe to run repeatedly.
 * (At runtime the Owner already resolves to every permission — see
 * lib/organization.ts — this keeps the stored roles and the Roles page honest.)
 *
 * Usage:  npx tsx prisma/sync-system-role-permissions.ts [--dry-run]
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../lib/generated/prisma/client';
import { PERMISSIONS, SYSTEM_ROLES } from '../lib/permissions';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const dryRun = process.argv.includes('--dry-run');

const ALL = Object.values(PERMISSIONS) as string[];
const definitions = new Map<string, string[]>(
  Object.values(SYSTEM_ROLES).map((role) => [role.name, role.permissions as string[]]),
);
const FULL_ACCESS = new Set<string>([SYSTEM_ROLES.OWNER.name, SYSTEM_ROLES.ADMIN.name]);

async function main() {
  // 1. Every permission the app defines has a row.
  const existing = new Set((await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key));
  const newRows = ALL.filter((key) => !existing.has(key));
  if (newRows.length) {
    console.log(`Creating permission rows: ${newRows.join(', ')}`);
    if (!dryRun) {
      await prisma.permission.createMany({
        data: newRows.map((key) => ({ key, module: key.split('.')[0] })),
        skipDuplicates: true,
      });
    }
  }
  const idByKey = new Map((await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));

  // 2. Per organization, what its Owner is missing is what the app added since.
  const organizations = await prisma.organization.findMany({
    select: {
      slug: true,
      roles: {
        where: { isSystem: true },
        select: { id: true, name: true, rolePermissions: { select: { permission: { select: { key: true } } } } },
      },
    },
  });

  let granted = 0;
  for (const org of organizations) {
    const owner = org.roles.find((r) => r.name === SYSTEM_ROLES.OWNER.name);
    if (!owner) continue;
    const ownerKeys = new Set(owner.rolePermissions.map((rp) => rp.permission.key));
    const added = ALL.filter((key) => !ownerKeys.has(key));
    if (!added.length) continue;

    for (const role of org.roles) {
      const held = new Set(role.rolePermissions.map((rp) => rp.permission.key));
      const allowed = FULL_ACCESS.has(role.name) ? ALL : definitions.get(role.name) ?? [];
      const toGrant = added.filter((key) => allowed.includes(key) && !held.has(key) && idByKey.has(key));
      if (!toGrant.length) continue;

      console.log(`${org.slug} / ${role.name}: + ${toGrant.join(', ')}`);
      granted += toGrant.length;
      if (!dryRun) {
        await prisma.rolePermission.createMany({
          data: toGrant.map((key) => ({ roleId: role.id, permissionId: idByKey.get(key)! })),
          skipDuplicates: true,
        });
      }
    }
  }

  console.log(`\n${dryRun ? 'Would grant' : 'Granted'} ${granted} permission(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
