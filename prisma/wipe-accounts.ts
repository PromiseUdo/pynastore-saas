/*
 * Wipe every shop and every non-staff account — a clean start before launch.
 *
 * Deletes, for EVERY organization: the shop and everything under it (products,
 * stock, orders, its shoppers' accounts, chats, notifications, domains on our
 * side, store apps…) through lib/data-rights/erase.ts, plus its uploaded files
 * on Cloudinary. Then every user who isn't platform staff. Keeps platform
 * staff, billing plans, platform settings and the platform's own logs.
 *
 * Nothing outside our database and Cloudinary is touched: Paystack
 * subaccounts, Meta app connections and Vercel domains stay where they are.
 *
 * Usage (DATABASE_URL picks the database — check it twice):
 *   npx tsx prisma/wipe-accounts.ts                 # dry run: shows what would go
 *   npx tsx prisma/wipe-accounts.ts --confirm <db-host>
 * <db-host> is the host in DATABASE_URL (e.g. ep-xxx-pooler.eu-central-1.aws.neon.tech),
 * so a wipe can't run against a database you didn't mean.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../lib/generated/prisma/client';
import { eraseOrganization } from '../lib/data-rights/erase';
import { destroyOrganizationAssets } from '../lib/cloudinary/sign';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const host = new URL(url).hostname;

const pool = new Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const args = process.argv.slice(2);
  const confirmAt = args.indexOf('--confirm');
  const confirmed = confirmAt !== -1 && args[confirmAt + 1] === host;
  if (confirmAt !== -1 && !confirmed) {
    console.error(`--confirm must be followed by this database's host: ${host}`);
    process.exitCode = 1;
    return;
  }

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, slug: true }, orderBy: { createdAt: 'asc' } });
  const shoppers = await prisma.customer.count();
  const users = await prisma.user.findMany({ where: { isPlatformStaff: false }, select: { email: true } });
  const staff = await prisma.user.findMany({ where: { isPlatformStaff: true }, select: { email: true } });

  console.log(`Database: ${host}`);
  console.log(`Shops to delete (${orgs.length}):`);
  for (const o of orgs) console.log(`  ${o.slug}  ${o.name}`);
  console.log(`Shopper records to delete: ${shoppers}`);
  console.log(`Accounts to delete (${users.length}): ${users.map((u) => u.email).join(', ') || '—'}`);
  console.log(`Platform staff kept (${staff.length}): ${staff.map((u) => u.email).join(', ') || '—'}`);

  if (!confirmed) {
    console.log(`\nDry run — nothing deleted. To delete: npx tsx prisma/wipe-accounts.ts --confirm ${host}`);
    return;
  }

  const cloudinary = Boolean(process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME);
  if (!cloudinary) console.log('\nCloudinary is not configured here: uploaded files will be left on Cloudinary.');

  for (const o of orgs) {
    const files = cloudinary ? await destroyOrganizationAssets(o.id) : 0;
    await prisma.$transaction((tx) => eraseOrganization(tx as never, o.id), { timeout: 300_000 });
    console.log(`Deleted ${o.slug} (${files} files)`);
  }

  const { count } = await prisma.user.deleteMany({ where: { isPlatformStaff: false } });
  console.log(`Deleted ${count} accounts. Done.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
