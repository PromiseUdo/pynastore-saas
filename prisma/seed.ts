/*
 * prisma/seed.ts
 *
 * Seeds all global permission keys into the database.
 * Permissions are global constants — roles are per-org and created by
 * bootstrapOrganization() when a new organization is onboarded.
 *
 * Run:  npx prisma db seed
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../lib/generated/prisma/client';
import { PERMISSIONS } from '../lib/permissions';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding permissions…');

  for (const key of Object.values(PERMISSIONS)) {
    const module = key.split('.')[0];
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, module },
    });
  }

  console.log(`✓ Seeded ${Object.values(PERMISSIONS).length} permissions`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
