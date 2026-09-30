/* A shop's own domain (ROADMAP 12.6) — the pure rules and the email wording. */
import { describe, expect, it } from 'vitest';
import {
  canonicalHostFor,
  cleanHost,
  comDomain,
  comSuggestions,
  dnsRecordsFor,
  isOverdue,
  orderTimeline,
  ownedDomain,
  reminderDue,
  renewalDeadline,
  renewalStage,
} from './rules';
import { domainFailedEmail, domainLiveEmail, renewalReminderEmail } from './emails';

const DAY = 24 * 60 * 60 * 1000;
const at = (base: Date, days: number) => new Date(base.getTime() + days * DAY);

describe('names', () => {
  it('buys .com only, explaining any other ending', () => {
    expect(comDomain('AdaFabrics')).toEqual({ ok: true, domain: 'adafabrics.com' });
    expect(comDomain('https://www.adafabrics.com/shop')).toEqual({ ok: true, domain: 'adafabrics.com' });
    expect(comDomain('adafabrics.ng')).toMatchObject({ ok: false, error: expect.stringMatching(/\.com addresses only/) });
    expect(comDomain('-bad')).toMatchObject({ ok: false });
  });

  it('connects the domain itself, including two-part endings, not a sub-address', () => {
    expect(ownedDomain('www.PNCollections.com')).toEqual({ ok: true, domain: 'pncollections.com' });
    expect(ownedDomain('pncollections.com.ng')).toEqual({ ok: true, domain: 'pncollections.com.ng' });
    expect(ownedDomain('shop.pncollections.com')).toMatchObject({ ok: false, error: expect.stringMatching(/pncollections\.com/) });
    expect(ownedDomain('localhost')).toMatchObject({ ok: false });
    expect(cleanHost('HTTP://Www.X.com:443/a?b')).toBe('x.com');
  });

  it('makes www canonical and suggests close .com names', () => {
    expect(canonicalHostFor('x.com')).toBe('www.x.com');
    const s = comSuggestions('ada-fabrics.com');
    expect(s[0]).toBe('adafabrics.com');
    expect(s).not.toContain('ada-fabrics.com');
    expect(s.every((d) => d.endsWith('.com'))).toBe(true);
  });

  it('lists the records to add', () => {
    expect(dnsRecordsFor({ cname: 'c.host', apexIp: '1.2.3.4' })).toEqual([
      { type: 'A', name: '@', value: '1.2.3.4' },
      { type: 'CNAME', name: 'www', value: 'c.host' },
    ]);
  });
});

describe('renewal', () => {
  const expiry = new Date('2027-06-30T00:00:00Z');

  it('sets the deadline a week before expiry and names each stage', () => {
    expect(renewalDeadline(expiry)).toEqual(new Date('2027-06-23T00:00:00Z'));
    expect(renewalStage(expiry, at(expiry, -60))).toBe('ok');
    expect(renewalStage(expiry, at(expiry, -20))).toBe('renew_soon');
    expect(renewalStage(expiry, at(expiry, -3))).toBe('past_deadline');
    expect(renewalStage(expiry, at(expiry, 5))).toBe('grace');
    expect(renewalStage(expiry, at(expiry, 40))).toBe('redemption');
    expect(renewalStage(expiry, at(expiry, 70))).toBe('released');
  });

  it('reminds 30/14/7/3/1 days before the deadline, on expiry, and weekly in grace — keyed to the expiry', () => {
    const deadline = renewalDeadline(expiry);
    expect(reminderDue(expiry, at(deadline, -40))).toBeNull();
    expect(reminderDue(expiry, at(deadline, -30))).toBe('before_30:2027-06-30');
    expect(reminderDue(expiry, at(deadline, -20))).toBe('before_30:2027-06-30');
    expect(reminderDue(expiry, at(deadline, -10))).toBe('before_14:2027-06-30');
    expect(reminderDue(expiry, at(deadline, -0.5))).toBe('before_1:2027-06-30');
    expect(reminderDue(expiry, at(expiry, 0.2))).toBe('expired:2027-06-30');
    expect(reminderDue(expiry, at(expiry, 8))).toBe('grace_w1:2027-06-30');
    expect(reminderDue(expiry, at(expiry, 22))).toBe('grace_w3:2027-06-30');
    expect(reminderDue(expiry, at(expiry, 31))).toBeNull();
  });
});

describe('the timeline', () => {
  it('follows the steps staff tick, and knows when it is late', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const t = orderTimeline({
      type: 'REGISTER',
      readyAt: new Date('2026-10-01T09:00:00Z'),
      stepRegisteredAt: new Date('2026-10-01T10:00:00Z'),
      stepDnsAt: null,
      stepHostAt: null,
      fulfilledAt: null,
    });
    expect(t.map((s) => [s.key, Boolean(s.at)])).toEqual([
      ['paid', true],
      ['registering', true],
      ['connecting', false],
      ['live', false],
    ]);
    expect(isOverdue(new Date('2026-10-01T09:00:00Z'), false, now)).toBe(true);
    expect(isOverdue(new Date('2026-10-02T09:00:00Z'), false, now)).toBe(false);
    expect(orderTimeline({ type: 'EXISTING', readyAt: now, stepRegisteredAt: null, stepDnsAt: now, stepHostAt: null, fulfilledAt: null }).map((s) => s.key)).toEqual([
      'paid',
      'connecting',
      'live',
    ]);
  });
});

describe('what the emails say', () => {
  it('tells the merchant it is live, failed, or due', () => {
    expect(domainLiveEmail({ shopName: 'Ada', host: 'www.ada.com', pageUrl: 'u' }).paragraphs[0]).toContain('https://www.ada.com');
    expect(domainFailedEmail({ shopName: 'Ada', domain: 'ada.com', reason: 'It was taken.', paid: true, pageUrl: 'u' }).paragraphs.join(' ')).toContain(
      'being returned',
    );
    const expiry = new Date('2027-06-30T00:00:00Z');
    const before = renewalReminderEmail({ shopName: 'Ada', domain: 'ada.com', expiresAt: expiry, renewNgn: 20000, pageUrl: 'u', kind: 'before_7' });
    expect(before.subject).toContain('Renew ada.com by 23 Jun 2027');
    expect(before.paragraphs[0]).toContain('₦20,000');
    expect(renewalReminderEmail({ shopName: 'Ada', domain: 'ada.com', expiresAt: expiry, renewNgn: null, pageUrl: 'u', kind: 'grace_w1' }).subject).toContain('has expired');
  });
});
