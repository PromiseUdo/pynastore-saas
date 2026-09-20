import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from './generated/prisma/client'

/*
 * pg currently treats sslmode=prefer|require|verify-ca as verify-full, warns
 * about it on every boot (surfacing as a console error in the Next overlay),
 * and will switch them to weaker libpq semantics in pg v9. Pin the behaviour
 * we already have — full certificate + hostname verification — explicitly,
 * so the warning stops and an upgrade can't silently weaken TLS. Neon's
 * certificates are publicly trusted, so verify-full needs no extra CA config.
 */
function withExplicitSslMode(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    const mode = url.searchParams.get('sslmode')
    if (mode && ['prefer', 'require', 'verify-ca'].includes(mode) && !url.searchParams.has('uselibpqcompat')) {
      url.searchParams.set('sslmode', 'verify-full')
    }
    return url.toString()
  } catch {
    return connectionString
  }
}

function createBasePrismaClient() {
  const connectionString = withExplicitSslMode(process.env.DATABASE_URL!)
  /*
   * Neon's pooler closes idle server connections (and the compute suspends
   * altogether), so a pooled client can be dead by the time pg hands it out —
   * surfacing as "Server has closed the connection". Recycle idle clients
   * quickly and cap connection lifetime so we never reuse a stale socket.
   */
  const pool = new Pool({
    connectionString,
    idleTimeoutMillis: 5_000,
    maxLifetimeSeconds: 60,
    connectionTimeoutMillis: 10_000,
  })

  // Without a listener, an async error on an idle client crashes the process.
  pool.on('error', (err) => {
    console.error('[prisma] idle pg client error:', err.message)
  })

  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

/*
 * pg.Pool hands out connections without validating them first, so there's an
 * unavoidable race where Neon kills a pooled connection between our idle
 * timeout and pg reusing it — the query on it fails with P1017
 * ConnectionClosed. That failure carries no query-side side effects (the
 * connection never reached the server), so retrying once is safe.
 */
function withConnectionRetry(client: PrismaClient) {
  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        try {
          return await query(args)
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P1017') {
            return await query(args)
          }
          throw err
        }
      },
    },
  })
}

function createPrismaClient() {
  return withConnectionRetry(createBasePrismaClient())
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>
  prismaClientClass?: typeof PrismaClient
}

/*
 * Dev keeps one client on globalThis so hot reload doesn't open a new pool on
 * every edit. But a client built before `prisma generate` doesn't know the new
 * models (`prisma.newModel` is undefined), and hot reload would keep handing
 * that stale one out. So it's reused only while it came from the generated
 * client that's loaded now; after a regenerate, it's replaced.
 */
function getPrismaClient() {
  const cached = globalForPrisma.prisma
  if (cached && globalForPrisma.prismaClientClass === PrismaClient) return cached
  if (cached) void cached.$disconnect().catch(() => {})
  return createPrismaClient()
}

export const prisma = getPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  globalForPrisma.prismaClientClass = PrismaClient
}
