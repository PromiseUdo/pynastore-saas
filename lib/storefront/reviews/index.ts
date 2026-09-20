/*
 * The rules only. ./read.ts and ./write.ts reach Prisma, so they are
 * imported directly by the server code that needs them — a client component
 * that wanted a star scale should never drag the database in behind it.
 */
export * from './rules';
