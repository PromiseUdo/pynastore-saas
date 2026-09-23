/*
 * lib/storefront/questions/read.ts
 *
 * Reading product questions for the storefront.
 *
 * Two audiences, two rules:
 *   - everyone sees the ANSWERED ones, because those are the pairs the
 *     merchant chose to publish;
 *   - the shopper who asked also sees their own question while it waits, so
 *     they can tell it arrived rather than asking it again.
 *
 * Every query names the organization as well as the product. A product id is
 * unique across the platform, but scoping by the store too means a mistake
 * upstream can only ever return nothing, not another merchant's questions.
 */
import { prisma } from '@/lib/prisma';
import type { ProductQuestion } from '../types';
import { toPublicQuestion } from './rules';

const PUBLIC_SELECT = {
  id: true,
  productId: true,
  body: true,
  createdAt: true,
  answerBody: true,
  answeredAt: true,
  customer: { select: { name: true } },
} as const;

/** The answered questions on one product, newest answer first. */
export async function listAnsweredQuestions(
  organizationId: string,
  productId: string,
): Promise<ProductQuestion[]> {
  const rows = await prisma.productQuestion.findMany({
    where: { organizationId, productId, status: 'ANSWERED' },
    orderBy: [{ answeredAt: 'desc' }, { createdAt: 'desc' }],
    select: PUBLIC_SELECT,
  });
  return rows.map(toPublicQuestion);
}

/** One shopper's own question on this product, still waiting for an answer. */
export interface PendingQuestion {
  id: string;
  body: string;
  createdAt: string;
}

export async function pendingQuestionsOf(input: {
  organizationId: string;
  customerId: string | null;
  productId: string;
}): Promise<PendingQuestion[]> {
  if (!input.customerId) return [];

  const rows = await prisma.productQuestion.findMany({
    where: {
      organizationId: input.organizationId,
      customerId: input.customerId,
      productId: input.productId,
      status: 'PENDING',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, body: true, createdAt: true },
  });

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  }));
}
