/*
 * Grant or revoke platform-staff access (the platform console, ROADMAP 11.1).
 *
 * This is deliberately a command, not a screen: whoever runs it already has
 * the production database credentials, which is the right bar for "may act on
 * every merchant". The user must already exist — they sign up like anyone
 * else first.
 *
 * Usage:
 *   npx tsx prisma/platform-staff.ts grant  person@example.com
 *   npx tsx prisma/platform-staff.ts revoke person@example.com
 *   npx tsx prisma/platform-staff.ts list
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../lib/generated/prisma/client';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const [command, rawEmail] = process.argv.slice(2);

  if (command === 'list') {
    const staff = await prisma.user.findMany({
      where: { isPlatformStaff: true },
      select: { email: true, name: true },
      orderBy: { email: 'asc' },
    });
    if (staff.length === 0) console.log('No platform staff.');
    for (const s of staff) console.log(`${s.email}${s.name ? `  (${s.name})` : ''}`);
    return;
  }

  if ((command !== 'grant' && command !== 'revoke') || !rawEmail) {
    console.error('Usage: npx tsx prisma/platform-staff.ts grant|revoke <email>  |  list');
    process.exitCode = 1;
    return;
  }

  const email = rawEmail.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true, isPlatformStaff: true },
  });
  if (!user) {
    console.error(`No user with the email ${email}. They need to sign up first.`);
    process.exitCode = 1;
    return;
  }

  const grant = command === 'grant';
  if (user.isPlatformStaff === grant) {
    console.log(`${user.email} ${grant ? 'is already' : 'is not'} platform staff. Nothing changed.`);
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { isPlatformStaff: grant } });
  console.log(`${user.email} ${grant ? 'can now' : 'can no longer'} open the platform console.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
