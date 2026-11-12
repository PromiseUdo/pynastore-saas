/*
 * The PIN rules shared by shopper and shop wallets (ROADMAP 20.3): what is
 * checked before EduPay is asked, and what each refusal says.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./edupay', () => ({ setUpPin: vi.fn(), changePin: vi.fn() }));

import { changePin, setUpPin } from './edupay';
import { changeWalletPin, createWalletPin, isPinShape } from './pin';

const ids = { uuid: 'u1', uniqId: 'Q1' };

beforeEach(() => {
  vi.mocked(setUpPin).mockReset();
  vi.mocked(changePin).mockReset();
});

describe('creating a PIN', () => {
  it('wants exactly four digits, typed the same twice — before asking EduPay', async () => {
    expect(isPinShape('4821')).toBe(true);
    expect(isPinShape('482')).toBe(false);
    expect(isPinShape('48a1')).toBe(false);
    await expect(createWalletPin(ids, { pin: '482', confirmPin: '482' })).resolves.toEqual({ ok: false, fieldErrors: { pin: 'Use exactly 4 digits.' } });
    await expect(createWalletPin(ids, { pin: '4821', confirmPin: '4812' })).resolves.toEqual({
      ok: false,
      fieldErrors: { confirmPin: 'The two PINs don’t match.' },
    });
    expect(setUpPin).not.toHaveBeenCalled();
  });

  it('passes EduPay’s answer on in plain words', async () => {
    vi.mocked(setUpPin).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: 'weak-pin' });
    await expect(createWalletPin(ids, { pin: '4821', confirmPin: '4821' })).resolves.toEqual({ ok: true });
    await expect(createWalletPin(ids, { pin: '1234', confirmPin: '1234' })).resolves.toMatchObject({
      ok: false,
      fieldErrors: { pin: expect.stringContaining('too easy') },
    });
  });
});

describe('changing a PIN', () => {
  it('needs the current PIN, and a new one that differs from it', async () => {
    await expect(changeWalletPin(ids, { currentPin: '', pin: '9073', confirmPin: '9073' })).resolves.toMatchObject({
      fieldErrors: { currentPin: expect.any(String) },
    });
    await expect(changeWalletPin(ids, { currentPin: '4821', pin: '4821', confirmPin: '4821' })).resolves.toMatchObject({
      fieldErrors: { pin: expect.stringContaining('different') },
    });
    expect(changePin).not.toHaveBeenCalled();
  });

  it('says so beside the field when the current PIN is wrong', async () => {
    vi.mocked(changePin).mockResolvedValueOnce({ ok: false, reason: 'wrong-pin' });
    await expect(changeWalletPin(ids, { currentPin: '1111', pin: '9073', confirmPin: '9073' })).resolves.toEqual({
      ok: false,
      fieldErrors: { currentPin: 'That isn’t your current PIN.' },
    });
  });
});
