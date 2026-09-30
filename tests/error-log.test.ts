/*
 * The error log and its alerts (ROADMAP 13.3), against the real database:
 * grouping, new / came-back / spike emails, the webhook monitor, the browser
 * endpoint, the server hook skipping Next's control flow, and /api/health.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mail = vi.hoisted(() => ({ subjects: [] as string[] }));
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendPlatformNoticeEmail: vi.fn(async (payload: { subject: string }) => {
    mail.subjects.push(payload.subject);
    return true;
  }),
}));

process.env.ERROR_LOG = 'on';
const previousInbox = process.env.PLATFORM_ADMIN_EMAIL;
process.env.PLATFORM_ADMIN_EMAIL = 'staff@example.com';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordError, SPIKE_PER_HOUR } from '@/lib/ops/errors';
import { recordServerError } from '@/lib/ops/server-errors';
import { POST as clientErrors } from '@/app/api/client-errors/route';
import { GET as health } from '@/app/api/health/route';
import { resolveError } from '@/features/platform/errors';

vi.mock('@/lib/platform-staff', () => ({
  requirePlatformStaff: async () => ({ userId: 'staff', name: 'Staff', email: 's@example.com' }),
  getPlatformStaff: async () => ({ userId: 'staff', name: 'Staff', email: 's@example.com' }),
}));

vi.setConfig({ testTimeout: 90_000 });

const tag = `__test-err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const where = (name: string) => `/${tag}/${name}`;

beforeEach(() => {
  mail.subjects.length = 0;
});

afterAll(async () => {
  const groups = await prisma.errorGroup.findMany({ where: { OR: [{ where: { startsWith: `/${tag}` } }, { message: { contains: tag } }] }, select: { id: true } });
  await prisma.opsAlert.deleteMany({ where: { subject: { in: groups.map((g) => `error:${g.id}`) } } });
  await prisma.errorGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
  await prisma.opsAlert.deleteMany({ where: { subject: 'webhook:paystack', sentAt: { gt: new Date(Date.now() - 3_600_000) } } });
  delete process.env.ERROR_LOG;
  process.env.PLATFORM_ADMIN_EMAIL = previousInbox;
});

describe('recording', () => {
  it('files occurrences of the same problem under one group, and emails once when it’s new', async () => {
    const first = await recordError({ source: 'server', where: where('orders'), kind: 'render', message: 'Order clx81abcdefghijklmnopqrstu not found' });
    const second = await recordError({ source: 'server', where: where('orders'), kind: 'render', message: 'Order clx92zyxwvutsrqponmlkjihgf not found' });
    expect(first?.isNew).toBe(true);
    expect(second).toMatchObject({ groupId: first!.groupId, isNew: false });
    const group = await prisma.errorGroup.findUniqueOrThrow({ where: { id: first!.groupId }, include: { _count: { select: { events: true } } } });
    expect(group.count).toBe(2);
    expect(group._count.events).toBe(2);
    expect(mail.subjects.filter((s) => s.startsWith('New error'))).toHaveLength(1);
  });

  it('doesn’t email for a new browser error — browsers are noisy — only files it', async () => {
    const r = await recordError({ source: 'client', where: where('page'), kind: 'browser', message: `quiet ${tag}` });
    expect(r?.isNew).toBe(true);
    expect(mail.subjects).toEqual([]);
  });

  it('reopens a resolved error that happens again, and says so', async () => {
    const r = await recordError({ source: 'server', where: where('comeback'), message: 'Comes back' });
    expect((await resolveError(r!.groupId)).success).toBe(true);
    mail.subjects.length = 0;
    const again = await recordError({ source: 'server', where: where('comeback'), message: 'Comes back' });
    expect(again?.cameBack).toBe(true);
    expect(mail.subjects.some((s) => s.startsWith('Error came back'))).toBe(true);
    expect((await prisma.errorGroup.findUniqueOrThrow({ where: { id: r!.groupId } })).resolvedAt).toBeNull();
  });

  it('emails once when an error spikes', async () => {
    const r = await recordError({ source: 'webhook', where: where('spiky'), message: 'Spiky' });
    await prisma.errorEvent.createMany({
      data: Array.from({ length: SPIKE_PER_HOUR.webhook }, () => ({ groupId: r!.groupId })),
    });
    mail.subjects.length = 0;
    await recordError({ source: 'webhook', where: where('spiky'), message: 'Spiky' });
    await recordError({ source: 'webhook', where: where('spiky'), message: 'Spiky' });
    expect(mail.subjects.filter((s) => s.startsWith('Error spiking'))).toHaveLength(1);
  });
});

describe('the server hook', () => {
  it('skips notFound() and redirect(), and files a real failure with a scrubbed path', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/x;307;' });
    await recordServerError(redirect, { path: `/${tag}/x`, method: 'GET', headers: {} }, { routePath: where('redirect'), routeType: 'render' });
    expect(await prisma.errorGroup.count({ where: { where: where('redirect') } })).toBe(0);

    const boom = Object.assign(new Error(`Boom ${tag}`), { digest: '998877' });
    await recordServerError(
      boom,
      { path: `/reset-password/Zx8aQ2lT0kP9mWbV4nR7yC1d?email=a@b.c`, method: 'GET', headers: { host: 'shop.example.com' } },
      { routePath: where('page'), routeType: 'render' },
    );
    const group = await prisma.errorGroup.findFirstOrThrow({ where: { where: where('page'), source: 'server' } });
    expect(group).toMatchObject({ kind: 'render', lastPath: '/reset-password/:token', lastDigest: '998877' });
  });
});

describe('the browser endpoint', () => {
  const post = (body: unknown, ip = `10.0.0.${Math.floor(Math.random() * 200)}`) =>
    clientErrors(
      new NextRequest('http://shop.example.com/api/client-errors', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { 'x-forwarded-for': ip, host: 'shop.example.com' },
      }),
    );

  it('files a real error under its place, and drops noise and junk', async () => {
    // A short first segment: a long random one would itself be scrubbed as a token.
    const seg = `t${tag.slice(-6)}`;
    expect((await post({ message: `Cannot read price ${tag}`, path: `/${seg}/products/clx81abcdefghijklmnopqrstu`, kind: 'boundary' })).status).toBe(204);
    expect((await post({ message: 'ResizeObserver loop limit exceeded', path: `/${seg}/x` })).status).toBe(204);
    expect((await post('not json')).status).toBe(204);
    expect((await post({ message: 'x'.repeat(20_000) })).status).toBe(204);

    const groups = await prisma.errorGroup.findMany({ where: { source: 'client', where: { startsWith: `/${seg}` } } });
    expect(groups.map((g) => [g.where, g.kind])).toEqual([[`/${seg}/products/:id`, 'boundary']]);
    await prisma.errorGroup.deleteMany({ where: { where: { startsWith: `/${seg}` } } });
  });
});

describe('the webhook monitor', () => {
  it('alerts once after repeated failures, then says when it works again', async () => {
    const { webhookFailed, webhookSucceeded } = await import('@/lib/ops/webhooks');
    await prisma.opsAlert.deleteMany({ where: { subject: 'webhook:paystack' } });
    for (let i = 0; i < 4; i += 1) {
      await webhookFailed('paystack', { kind: 'processing', message: `Couldn’t process “charge.success”: test ${tag}` });
    }
    expect(mail.subjects.filter((s) => s === 'Paystack webhook is failing')).toHaveLength(1);
    await webhookSucceeded('paystack');
    expect(mail.subjects).toContain('Working again: Paystack webhook');
  });
});

describe('/api/health', () => {
  it('answers 200 with the database reachable, and caches nothing', async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
  });
});

describe('/api/csp-report', () => {
  it('files what the policy blocked by directive and origin, and drops extensions', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    const send = (report: Record<string, string>) =>
      POST(
        new NextRequest('http://shop.example.com/api/csp-report', {
          method: 'POST',
          body: JSON.stringify({ 'csp-report': report }),
          headers: { 'content-type': 'application/csp-report', 'x-forwarded-for': `10.1.0.${Math.floor(Math.random() * 200)}` },
        }),
      );
    const directive = `script-src-${tag.slice(-6)}`;
    expect((await send({ 'document-uri': 'https://shop.example.com/products?x=1', 'effective-directive': directive, 'blocked-uri': 'https://evil.example/x.js?y=2' })).status).toBe(204);
    expect((await send({ 'document-uri': 'https://shop.example.com/', 'effective-directive': directive, 'blocked-uri': 'chrome-extension://abc/inject.js' })).status).toBe(204);

    const groups = await prisma.errorGroup.findMany({ where: { where: `csp:${directive}` } });
    expect(groups.map((g) => [g.kind, g.message, g.lastPath])).toEqual([
      ['csp', `The security policy blocked https://evil.example (${directive})`, '/products'],
    ]);
    await prisma.errorGroup.deleteMany({ where: { where: `csp:${directive}` } });
  });
});
