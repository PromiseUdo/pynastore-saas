/*
 * The rules only. ./read.ts and ./write.ts reach Prisma, so they are
 * imported directly by the server code that needs them — the ask form wants
 * the length limits, not the database behind them.
 */
export * from './rules';
