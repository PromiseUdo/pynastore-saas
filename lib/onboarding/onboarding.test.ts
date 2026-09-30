/* The pure onboarding rules (ROADMAP 12.5): web addresses, starter categories, the guide, reminders, emails. */
import { describe, expect, it } from 'vitest';
import { addressCandidates, addressProblem, toShopAddress } from './shop-address';
import { acceptedCategories, isBusinessType, isSalesChannels } from './business';
import { stepOrder, summarize, type SetupStepKey } from './setup-steps';
import { setupReminderDue, trialReminderDue } from './reminders';
import { setupReminderEmail, trialEndingEmail, welcomeEmail } from './emails';

const DAY = 24 * 60 * 60 * 1000;

describe('web addresses', () => {
  it('turns a name into an address', () => {
    expect(toShopAddress('Ada’s Fabrics & Co.')).toBe('adas-fabrics-and-co');
    expect(toShopAddress('  Émeka  Phones  ')).toBe('emeka-phones');
    expect(toShopAddress('!!!')).toBe('');
  });

  it('refuses what the rules forbid', () => {
    expect(addressProblem('ab')).toBe('too-short');
    expect(addressProblem('a'.repeat(41))).toBe('too-long');
    expect(addressProblem('-ada')).toBe('invalid');
    expect(addressProblem('ada--shop')).toBe('invalid');
    expect(addressProblem('Ada')).toBe('invalid');
    expect(addressProblem('platform')).toBe('reserved');
    expect(addressProblem('shop-ada')).toBe('reserved');
    expect(addressProblem('adas-fabrics')).toBeNull();
  });

  it('suggests valid alternatives, the city first, and never the address itself', () => {
    const c = addressCandidates('ada', 'Port Harcourt');
    expect(c[0]).toBe('ada-port-harcourt');
    expect(c).not.toContain('ada');
    expect(c.every((x) => addressProblem(x) === null)).toBe(true);
    expect(new Set(c).size).toBe(c.length);
  });
});

describe('starter categories', () => {
  it('keeps only what was offered, in the offered order', () => {
    expect(acceptedCategories('fashion', ['Shoes', 'Women', 'Made up'])).toEqual(['Women', 'Shoes']);
    expect(acceptedCategories('other', ['Anything'])).toEqual([]);
    expect(isBusinessType('fashion')).toBe(true);
    expect(isBusinessType('toString')).toBe(false);
    expect(isSalesChannels('BOTH')).toBe(true);
    expect(isSalesChannels('both')).toBe(false);
  });
});

const none: Record<SetupStepKey, boolean> = {
  store_place: false,
  sells_online: false,
  delivery: false,
  product: false,
  payment: false,
  open: false,
  logo: false,
  store_pages: false,
  domain: false,
};

describe('the setup guide', () => {
  it('orders online-first and in-person-first shops differently, same steps', () => {
    expect(stepOrder('ONLINE').slice(0, 4)).toEqual(['store_place', 'sells_online', 'delivery', 'product']);
    expect(stepOrder('IN_PERSON').slice(0, 3)).toEqual(['store_place', 'product', 'payment']);
    expect(new Set(stepOrder('IN_PERSON'))).toEqual(new Set(stepOrder('ONLINE')));
  });

  it('is ready to open only when every required step is done — payment is recommended, not required', () => {
    const almost = summarize({ ...none, store_place: true, sells_online: true, delivery: true }, 'ONLINE');
    expect(almost.readyToOpen).toBe(false);
    expect(almost.next?.key).toBe('product');
    expect(almost.requiredDone).toBe(3);

    const ready = summarize({ ...none, store_place: true, sells_online: true, delivery: true, product: true }, 'ONLINE');
    expect(ready.readyToOpen).toBe(true);
    expect(ready.next?.key).toBe('payment');
    expect(ready.complete).toBe(false);
  });

  it('is complete once open and paid for, whatever the optional extras', () => {
    const done = summarize({ ...none, store_place: true, sells_online: true, delivery: true, product: true, payment: true, open: true }, null);
    expect(done.complete).toBe(true);
    expect(done.isOpen).toBe(true);
  });
});

describe('reminders', () => {
  const now = new Date('2026-10-10T08:00:00Z');
  it('sends setup nudges on days 3 and 7 only', () => {
    expect(setupReminderDue(new Date(now.getTime() - 2 * DAY), now)).toBeNull();
    expect(setupReminderDue(new Date(now.getTime() - 3.5 * DAY), now)).toBe('setup_day_3');
    expect(setupReminderDue(new Date(now.getTime() - 8 * DAY), now)).toBe('setup_day_7');
    expect(setupReminderDue(new Date(now.getTime() - 15 * DAY), now)).toBeNull();
  });

  it('warns 3 days and 1 day before a trial ends, never after', () => {
    expect(trialReminderDue(new Date(now.getTime() + 5 * DAY), now)).toBeNull();
    expect(trialReminderDue(new Date(now.getTime() + 2.5 * DAY), now)).toBe('trial_ends_3d');
    expect(trialReminderDue(new Date(now.getTime() + 0.5 * DAY), now)).toBe('trial_ends_1d');
    expect(trialReminderDue(new Date(now.getTime() - DAY), now)).toBeNull();
  });
});

describe('what the emails say', () => {
  it('welcomes with both addresses and the trial', () => {
    const e = welcomeEmail({
      shopName: 'Ada',
      storefrontUrl: 'https://shop-ada.example.com',
      adminUrl: 'https://ada.example.com/dashboard',
      trial: { planName: 'Pro', endsAt: new Date('2026-10-20T00:00:00Z') },
      firstStep: 'Set up delivery or pickup',
    });
    const text = e.paragraphs.join(' ');
    expect(text).toContain('https://shop-ada.example.com');
    expect(text).toContain('Opening soon');
    expect(text).toContain('free trial of Pro');
    expect(text).toContain('set up delivery or pickup');
  });

  it('lists the steps left, and states the grace honestly', () => {
    expect(setupReminderEmail({ shopName: 'Ada', stepsLeft: ['A', 'B'], adminUrl: 'u', day: 3 }).list).toEqual(['A', 'B']);
    const grace = trialEndingEmail({ shopName: 'Ada', planName: 'Pro', endsAt: new Date(), graceDays: 10, upgradeUrl: 'u', daysLeft: 3 });
    expect(grace.paragraphs.join(' ')).toContain('10 more days');
    const none0 = trialEndingEmail({ shopName: 'Ada', planName: 'Pro', endsAt: new Date(), graceDays: 0, upgradeUrl: 'u', daysLeft: 1 });
    expect(none0.subject).toContain('tomorrow');
    expect(none0.paragraphs.join(' ')).toContain('closes when the trial ends');
  });
});
