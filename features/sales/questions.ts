'use server';

/*
 * features/sales/questions.ts
 *
 * The merchant's side of product questions.
 *
 * A shopper asks from the product page (lib/storefront/questions/) and the
 * question lands here, waiting. Nothing is on the storefront until someone
 * answers it: answering IS publishing, which is why it needs its own
 * permission rather than riding on `sales.view`.
 *
 * A merchant can't write a question — only a customer account can — and
 * can't edit the words of one. What they can do is answer it, change their
 * own answer afterwards, and hide a question they'd rather not publish
 * (abuse, someone's phone number, a rant about a courier). Hiding keeps the
 * row and the audit entry, so the decision is answerable and reversible.
 *
 * Viewing needs `sales.view`; answering and hiding need `sales.question.answer`.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { validateAnswer } from '@/lib/storefront/questions/rules';

type Result<T = void> = { success: true; data: T } | { success: false; error: string };

export interface QuestionRow {
  id: string;
  body: string;
  status: 'PENDING' | 'ANSWERED' | 'HIDDEN';
  answerBody: string | null;
  answeredAt: string | null;
  answeredByName: string | null;
  hiddenReason: string | null;
  createdAt: string;
  customerName: string;
  customerEmail: string | null;
  productId: string;
  productName: string;
  productSlug: string | null;
}

export interface QuestionListSummary {
  total: number;
  /** asked and waiting — the number that means work to do */
  pending: number;
  answered: number;
  hidden: number;
}

export type QuestionStatusFilter = 'all' | 'pending' | 'answered' | 'hidden';

const STATUS_OF: Record<Exclude<QuestionStatusFilter, 'all'>, 'PENDING' | 'ANSWERED' | 'HIDDEN'> = {
  pending: 'PENDING',
  answered: 'ANSWERED',
  hidden: 'HIDDEN',
};

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to answer customer questions' };
  }
  console.error(`[sales/questions] ${fallback}:`, error);
  return { success: false, error: fallback };
}

async function context(permission: 'view' | 'answer') {
  const ctx = await getOrganizationContext();
  requirePermission(
    ctx.membership.role.permissions,
    permission === 'view' ? PERMISSIONS.SALES_VIEW : PERMISSIONS.SALES_QUESTION_ANSWER,
  );
  return ctx;
}

export async function listQuestions(
  filter: { status?: QuestionStatusFilter; search?: string } = {},
): Promise<Result<{ rows: QuestionRow[]; summary: QuestionListSummary }>> {
  try {
    const ctx = await context('view');
    const organizationId = ctx.organization.id;
    const search = filter.search?.trim();
    const status = filter.status && filter.status !== 'all' ? STATUS_OF[filter.status] : undefined;

    const where = {
      organizationId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { body: { contains: search, mode: 'insensitive' as const } },
              { answerBody: { contains: search, mode: 'insensitive' as const } },
              { product: { name: { contains: search, mode: 'insensitive' as const } } },
              { customer: { name: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [rows, counts] = await Promise.all([
      prisma.productQuestion.findMany({
        where,
        /* Waiting ones first whatever the sort within them: this page is a
         * to-do list before it is a history. */
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 200,
        select: {
          id: true,
          body: true,
          status: true,
          answerBody: true,
          answeredAt: true,
          hiddenReason: true,
          createdAt: true,
          productId: true,
          customer: { select: { name: true, email: true } },
          product: { select: { name: true, slug: true } },
          answeredBy: { select: { name: true, email: true } },
        },
      }),
      prisma.productQuestion.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
    ]);

    const byStatus = new Map(counts.map((row) => [row.status, row._count._all]));
    const pending = byStatus.get('PENDING') ?? 0;
    const answered = byStatus.get('ANSWERED') ?? 0;
    const hidden = byStatus.get('HIDDEN') ?? 0;

    return {
      success: true,
      data: {
        rows: rows.map((row) => ({
          id: row.id,
          body: row.body,
          status: row.status,
          answerBody: row.answerBody,
          answeredAt: row.answeredAt?.toISOString() ?? null,
          answeredByName: row.answeredBy?.name ?? row.answeredBy?.email ?? null,
          hiddenReason: row.hiddenReason,
          createdAt: row.createdAt.toISOString(),
          customerName: row.customer.name,
          customerEmail: row.customer.email,
          productId: row.productId,
          productName: row.product.name,
          productSlug: row.product.slug,
        })),
        summary: { total: pending + answered + hidden, pending, answered, hidden },
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your customer questions');
  }
}

/**
 * How many questions are waiting, for the Sales landing page's callout.
 * Returns 0 rather than failing: a broken count must not take a page down.
 */
export async function pendingQuestionCount(): Promise<number> {
  try {
    const ctx = await context('view');
    return await prisma.productQuestion.count({
      where: { organizationId: ctx.organization.id, status: 'PENDING' },
    });
  } catch {
    return 0;
  }
}

/**
 * Answer a question — which publishes it, with the answer, on the product
 * page. Running it again on an answered question replaces the answer, so
 * fixing a typo is the same action rather than a second one.
 */
export async function answerQuestion(questionId: string, answer: string): Promise<Result> {
  try {
    const ctx = await context('answer');
    const checked = validateAnswer(answer);
    if (!checked.ok) return { success: false, error: checked.message };

    const updated = await prisma.productQuestion.updateMany({
      where: { id: questionId, organizationId: ctx.organization.id },
      data: {
        answerBody: checked.value,
        answeredAt: new Date(),
        answeredByUserId: ctx.userId,
        status: 'ANSWERED',
        hiddenReason: null,
        hiddenAt: null,
      },
    });
    if (!updated.count) return { success: false, error: 'That question no longer exists' };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.question.answer',
      entityType: 'ProductQuestion',
      entityId: questionId,
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t publish this answer');
  }
}

/**
 * Keep a question off the storefront. If it was already answered, this takes
 * the pair down too. The reason is for the merchant's own record — the
 * shopper is not told, and it never appears on the store.
 */
export async function hideQuestion(questionId: string, reason: string): Promise<Result> {
  try {
    const ctx = await context('answer');
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      return { success: false, error: 'Say briefly why, so the decision makes sense later' };
    }
    if (trimmed.length > 200) return { success: false, error: 'Keep it under 200 characters' };

    const updated = await prisma.productQuestion.updateMany({
      where: { id: questionId, organizationId: ctx.organization.id },
      data: { status: 'HIDDEN', hiddenReason: trimmed, hiddenAt: new Date() },
    });
    if (!updated.count) return { success: false, error: 'That question no longer exists' };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.question.hide',
      entityType: 'ProductQuestion',
      entityId: questionId,
      metadata: { reason: trimmed },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t hide this question');
  }
}

/**
 * Undo hiding. A question that had an answer goes back on the storefront
 * with it; one that never did goes back to waiting, because restoring must
 * never publish something nobody answered.
 */
export async function restoreQuestion(questionId: string): Promise<Result> {
  try {
    const ctx = await context('answer');

    const question = await prisma.productQuestion.findFirst({
      where: { id: questionId, organizationId: ctx.organization.id },
      select: { id: true, answerBody: true },
    });
    if (!question) return { success: false, error: 'That question no longer exists' };

    await prisma.productQuestion.update({
      where: { id: question.id },
      data: {
        status: question.answerBody ? 'ANSWERED' : 'PENDING',
        hiddenReason: null,
        hiddenAt: null,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.question.restore',
      entityType: 'ProductQuestion',
      entityId: questionId,
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t restore this question');
  }
}
