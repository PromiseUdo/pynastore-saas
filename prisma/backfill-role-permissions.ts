/*
 * Backfill script — run once if you created organizations BEFORE running
 * `npx prisma db seed`. It assigns the correct permission set to every
 * system role whose rolePermissions is currently empty.
 *
 * Usage:  npx tsx prisma/backfill-role-permissions.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../lib/generated/prisma/client';
import { SYSTEM_ROLES } from '../lib/permissions';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Find all system roles with no permissions linked
  const emptyRoles = await prisma.role.findMany({
    where: {
      isSystem: true,
      rolePermissions: { none: {} },
    },
    select: { id: true, name: true, organizationId: true },
  });

  if (emptyRoles.length === 0) {
    console.log('✓ All system roles already have permissions. Nothing to do.');
    return;
  }

  console.log(`Found ${emptyRoles.length} role(s) with missing permissions:`);

  // Build a name → permission keys map from SYSTEM_ROLES
  const roleDefMap = new Map<string, string[]>(
    Object.values(SYSTEM_ROLES).map((r) => [r.name, r.permissions as string[]]),
  );

  for (const role of emptyRoles) {
    const permissionKeys = roleDefMap.get(role.name);
    if (!permissionKeys) {
      console.warn(`  ⚠ Unknown system role: ${role.name} — skipping`);
      continue;
    }

    // Fetch the permission IDs from the DB
    const permissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true, key: true },
    });

    if (permissions.length === 0) {
      console.warn(`  ⚠ No permissions found in DB for role "${role.name}". Run npx prisma db seed first.`);
      continue;
    }

    // Create the missing rolePermissions
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({
        roleId: role.id,
        permissionId: p.id,
      })),
      skipDuplicates: true,
    });

    console.log(`  ✓ ${role.name} (org ${role.organizationId}) → ${permissions.length} permissions linked`);
  }

  console.log('\n✓ Done. Restart your dev server for the changes to take effect.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
