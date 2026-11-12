/*
 * The EduPay client (ROADMAP 20.2), with fetch faked: the signature EduPay
 * checks, and what each answer becomes — including that a generated
 * password never leaves the client.
 */
import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalString,
  confirmWithdraw,
  debitForOrder,
  getAutoWithdraw,
  getBankAccounts,
  requestWithdraw,
  withdrawalState,
  changePin,
  findTransfer,
  fundingState,
  getPinStatus,
  getTransactions,
  getWallet,
  initiateFunding,
  registerUser,
  setUpPin,
  transferFunds,
  verifyPin,
  type RegisterInput,
} from './edupay';

const KEY = 'test-service-key';
const BASE = 'https://edupay.example/test-backend/api/v1/wallet-service';

const INPUT: RegisterInput = {
  userType: 'normal',
  userRef: 'shopper-c1',
  fullName: 'Ada Okafor',
  email: 'ada@example.com',
  phone: '08031234567',
  username: 'adaokafor7k2m9q',
};

let fetchMock: ReturnType<typeof vi.fn>;
function answer(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.stubEnv('EDUPAY_SERVICE_URL', BASE);
  vi.stubEnv('EDUPAY_SERVICE_KEY', KEY);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('signing', () => {
  it('signs method|path|timestamp|nonce|body the way EduPay checks it', async () => {
    answer(200, { success: true, user: { uuid_v4: 'u1', uniq_id: 'Q1' } });
    await registerUser(INPUT);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expected = createHmac('sha256', KEY)
      .update(canonicalString('POST', '/test-backend/api/v1/wallet-service/', Number(headers['X-Service-Timestamp']), headers['X-Service-Nonce'], String(init.body)))
      .digest('hex');

    expect(String(url)).toBe(`${BASE}/`);
    expect(headers['X-Service-Signature']).toBe(expected);
    expect(headers['X-Service-Nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(String(init.body))).toMatchObject({
      action: 'register_user',
      user_type: 'normal',
      user_ref: 'shopper-c1',
      phone: '08031234567',
    });
  });
});

describe('registerUser', () => {
  it('returns the new wallet’s ids — and never the generated password', async () => {
    answer(200, {
      success: true,
      user: { uuid_v4: 'u1', uniq_id: 'Q1' },
      credentials: { password: 'YJg#u-9yPc*w', password_was_generated: true },
    });
    const result = await registerUser(INPUT);
    expect(result).toEqual({ kind: 'created', uuid: 'u1', uniqId: 'Q1' });
    expect(JSON.stringify(result)).not.toContain('YJg');
  });

  it('reports an existing user with what matched', async () => {
    answer(409, {
      success: false,
      error_code: 'USER_EXISTS',
      matched_on: 'email',
      existing_user: { uuid_v4: 'u2', uniq_id: 'Q2', email: 'ada@example.com', phone: '0803', full_name: 'Ada' },
    });
    await expect(registerUser(INPUT)).resolves.toEqual({
      kind: 'exists',
      matchedOn: 'email',
      uuid: 'u2',
      uniqId: 'Q2',
      email: 'ada@example.com',
    });
  });

  it('tells a taken username and a taken reference apart', async () => {
    answer(409, { success: false, error_code: 'USERNAME_TAKEN' });
    answer(409, { success: false, error_code: 'USER_REF_TAKEN', message: 'This user_ref is already taken' });
    await expect(registerUser(INPUT)).resolves.toEqual({ kind: 'username-taken' });
    await expect(registerUser(INPUT)).resolves.toEqual({ kind: 'user-ref-taken', uuid: null, uniqId: null });
  });

  it('calls a 5xx, a timeout or a network failure "unavailable", never a refusal', async () => {
    answer(503, { success: false });
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('slow'), { name: 'TimeoutError' }));
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(registerUser(INPUT)).resolves.toEqual({ kind: 'unavailable', reason: 'HTTP 503' });
    await expect(registerUser(INPUT)).resolves.toEqual({ kind: 'unavailable', reason: 'timed out' });
    await expect(registerUser(INPUT)).resolves.toEqual({ kind: 'unavailable', reason: 'network error' });
  });

  it('retries EduPay’s own failures, even when they arrive as HTTP 200', async () => {
    answer(200, { success: false, message: 'Failed to register user', error_code: 'INTERNAL_ERROR' });
    await expect(registerUser(INPUT)).resolves.toEqual({ kind: 'unavailable', reason: 'EduPay INTERNAL_ERROR' });
  });

  it('is unavailable without settings, and sends nothing', async () => {
    vi.stubEnv('EDUPAY_SERVICE_KEY', '');
    await expect(registerUser(INPUT)).resolves.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('reading a wallet', () => {
  const ids = { uuid: 'u1', uniqId: 'Q1' };

  it('turns EduPay’s naira into kobo', async () => {
    answer(200, { success: true, wallet: { balance: 2500.5, currency: 'NGN', status: 'active', has_transaction_pin: false } });
    await expect(getWallet(ids)).resolves.toEqual({ balanceKobo: 250050, currency: 'NGN', status: 'active', hasPin: false });
  });

  it('reads transactions defensively, skipping any it can’t make sense of', async () => {
    answer(200, {
      success: true,
      transactions: [
        { reference: 'FUND_1', type: 'credit', amount: '5000', description: 'Wallet top-up', status: 'completed', created_at: '2026-10-15 17:41:00' },
        { id: 7, type: 'DEBIT', amount: -1500, status: 'pending' },
        { description: 'no reference or amount' },
      ],
      pagination: { has_more: true, total: 12 },
    });
    const result = await getTransactions(ids);
    expect(result?.hasMore).toBe(true);
    expect(result?.total).toBe(12);
    expect(result?.items).toEqual([
      { reference: 'FUND_1', direction: 'credit', amountKobo: 500000, description: 'Wallet top-up', status: 'completed', createdAt: '2026-10-15T16:41:00.000Z' },
      { reference: '7', direction: 'debit', amountKobo: 150000, description: null, status: 'pending', createdAt: null },
    ]);
  });

  it('is null when EduPay doesn’t answer', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(getWallet(ids)).resolves.toBeNull();
    await expect(getTransactions(ids)).resolves.toBeNull();
  });
});

describe('the transaction PIN', () => {
  const ids = { uuid: 'u1', uniqId: 'Q1' };
  const sent = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i] as [URL, RequestInit])[1].body));

  it('sends setup and update the way EduPay takes them', async () => {
    answer(200, { success: true });
    answer(200, { success: true });
    await expect(setUpPin(ids, '4821')).resolves.toEqual({ ok: true });
    await expect(changePin(ids, '4821', '9073')).resolves.toEqual({ ok: true });
    expect(sent(0)).toEqual({ action: 'setup_transaction_pin', uuid_v4: 'u1', uniq_id: 'Q1', action_type: 'setup', pin: '4821' });
    expect(sent(1)).toEqual({ action: 'setup_transaction_pin', uuid_v4: 'u1', uniq_id: 'Q1', action_type: 'update', current_pin: '4821', pin: '9073' });
  });

  it('reads refusals from the code or, failing that, the message', async () => {
    answer(400, { success: false, error_code: 'INCORRECT_PIN' });
    answer(400, { success: false, message: 'Transaction PIN is locked. Try again later.' });
    answer(400, { success: false, message: 'PIN already set up' });
    answer(400, { success: false, message: 'Something unexpected' });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(verifyPin(ids, '0000')).resolves.toEqual({ ok: false, reason: 'wrong-pin' });
    await expect(verifyPin(ids, '0000')).resolves.toEqual({ ok: false, reason: 'locked' });
    await expect(setUpPin(ids, '4821')).resolves.toEqual({ ok: false, reason: 'already-set' });
    await expect(setUpPin(ids, '4821')).resolves.toEqual({ ok: false, reason: 'rejected' });
    await expect(setUpPin(ids, '4821')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('reads the status EduPay returns', async () => {
    answer(200, {
      success: true,
      status: { is_set: true, is_locked: true, attempts_remaining: 0, locked_until: '2026-10-19 18:30:00' },
      has_pin: true,
    });
    await expect(getPinStatus(ids)).resolves.toEqual({ isSet: true, isLocked: true, lockedUntil: '2026-10-19T17:30:00.000Z' });
  });

  it('never puts the PIN in a log line', async () => {
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    answer(400, { success: false, error_code: 'INCORRECT_PIN' });
    answer(503, {});
    await verifyPin(ids, '7319');
    await setUpPin(ids, '7319');
    const logged = [...error.mock.calls, ...warn.mock.calls].flat().join(' ');
    expect(logged).not.toContain('7319');
  });
});

describe('top-ups', () => {
  const ids = { uuid: 'u1', uniqId: 'Q1' };
  const sent = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i] as [URL, RequestInit])[1].body));

  /** EduPay's own example reply (2026-10-25). */
  const STARTED = {
    success: true,
    message: 'Wallet funding initiated successfully',
    payment_reference: 'TXREF_ECOM_1792961711_491172',
    amount_paid: 1500,
    transaction_percent: 1.5,
    transaction_added: 100,
    transaction_capped: 2000,
    transaction_charges: 122.5,
    total_amount: 1622.5,
    gateway: 'paystack',
    public_key: 'pk_test_x',
    access_code: 'ty4ex4nz4vgoyxo',
    authorization_url: 'https://checkout.paystack.com/ty4ex4nz4vgoyxo',
    gateway_reference: 'TXREF_ECOM_1792961711_491172',
    ecom_wallet_payment_id: '7',
    wallet_reference: null,
    transaction_id: null,
    expires_at: '2026-10-25 22:25:12',
  };

  it('starts a Paystack payment and reads the charges and access code', async () => {
    answer(200, STARTED);
    const result = await initiateFunding(ids, { amount: 1500, description: 'Wallet top-up', metadata: { source: 'notely' } });
    expect(sent()).toEqual({
      action: 'initiate_fund_wallet',
      uuid_v4: 'u1',
      uniq_id: 'Q1',
      amount: 1500,
      description: 'Wallet top-up',
      gateway: 'paystack',
      redirect_url: '',
      metadata: { source: 'notely' },
    });
    expect(result).toEqual({
      kind: 'started',
      reference: 'TXREF_ECOM_1792961711_491172',
      accessCode: 'ty4ex4nz4vgoyxo',
      amount: 1500,
      fee: 122.5,
      total: 1622.5,
      expiresAt: '2026-10-25T21:25:12.000Z',
    });
  });

  it('is a refusal without an access code, and unavailable when EduPay is down', async () => {
    answer(400, { success: false, message: 'Amount below minimum' });
    answer(200, { ...STARTED, access_code: null });
    answer(502, {});
    await expect(initiateFunding(ids, { amount: 50, description: 'x', metadata: {} })).resolves.toEqual({ kind: 'rejected', message: 'Amount below minimum' });
    await expect(initiateFunding(ids, { amount: 1500, description: 'x', metadata: {} })).resolves.toMatchObject({ kind: 'rejected' });
    await expect(initiateFunding(ids, { amount: 1500, description: 'x', metadata: {} })).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it('reads whether it landed from the transaction status first', async () => {
    answer(200, { success: true, status: 'completed' });
    await expect(fundingState(ids, 'TXREF_1')).resolves.toBe('completed');
    expect(sent()).toMatchObject({ action: 'get_transaction_status', reference: 'TXREF_1' });
  });

  it('falls back to finding the reference among the wallet’s transactions', async () => {
    answer(404, { success: false, message: 'Transaction not found' });
    answer(200, { success: true, transactions: [{ reference: 'FUND_9', gateway_reference: 'TXREF_1', amount: 1500, status: 'success' }] });
    await expect(fundingState(ids, 'TXREF_1')).resolves.toBe('completed');
  });

  it('finds the reference in the description, where EduPay actually puts it', async () => {
    answer(200, { success: false, message: 'Transaction not found' });
    answer(200, {
      success: true,
      transactions: [
        { reference: 'TXN2', amount: 500, description: 'Wallet funding via paystack (TXREF_ECOM_12)', status: 'completed' },
        { reference: 'TXN1', amount: 1700, description: 'Wallet funding via paystack (TXREF_ECOM_1)', status: 'completed' },
      ],
    });
    await expect(fundingState(ids, 'TXREF_ECOM_1')).resolves.toBe('completed');

    answer(200, { success: false, message: 'Transaction not found' });
    answer(200, { success: true, transactions: [{ reference: 'TXN2', amount: 500, description: 'Wallet funding via paystack (TXREF_ECOM_12)', status: 'completed' }] });
    await expect(fundingState(ids, 'TXREF_ECOM_1')).resolves.toBe('unknown');
  });

  it('is unknown while EduPay hasn’t heard of it, and unavailable when it can’t be asked', async () => {
    answer(404, { success: false });
    answer(200, { success: true, transactions: [] });
    await expect(fundingState(ids, 'TXREF_2')).resolves.toBe('unknown');

    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(fundingState(ids, 'TXREF_2')).resolves.toBe('unavailable');
  });
});

describe('moving money between wallets (20.5)', () => {
  const ids = { uuid: 'u-from', uniqId: 'FROM' };
  const shop = { uuid: 'u-shop', uniqId: 'SHOP' };
  const send = () => transferFunds(ids, shop, { amount: 2500, description: 'Order ORD-1 (ORD-1-WABC)', pin: '1234' });

  it('sends one transfer_funds, from the payer to the recipient, with the PIN', async () => {
    answer(200, { success: true, transaction: { reference: 'TXN9' } });
    await expect(send()).resolves.toMatchObject({ kind: 'sent', reference: 'TXN9' });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      action: 'transfer_funds',
      uuid_v4: 'u-from',
      uniq_id: 'FROM',
      recipient_uuid_v4: 'u-shop',
      recipient_uniq_id: 'SHOP',
      amount: 2500,
      description: 'Order ORD-1 (ORD-1-WABC)',
      pin: '1234',
    });
  });

  it('reads a refusal as nothing moved', async () => {
    answer(200, { success: false, error_code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' });
    await expect(send()).resolves.toMatchObject({ kind: 'refused', reason: 'insufficient' });
    answer(200, { success: false, error_code: 'INVALID_PIN', message: 'Incorrect PIN' });
    await expect(send()).resolves.toMatchObject({ kind: 'refused', reason: 'wrong-pin' });
    answer(200, { success: false, error_code: 'PIN_LOCKED', message: 'PIN locked' });
    await expect(send()).resolves.toMatchObject({ kind: 'refused', reason: 'locked' });
    answer(200, { success: false, error_code: 'PIN_NOT_SET', message: 'Transaction PIN not set' });
    await expect(send()).resolves.toMatchObject({ kind: 'refused', reason: 'pin-not-set' });
  });

  it('never reads a crash or a timeout as refused — the money may have moved', async () => {
    answer(200, { success: false, error_code: 'INTERNAL_ERROR' });
    await expect(send()).resolves.toMatchObject({ kind: 'unknown' });
    fetchMock.mockResolvedValueOnce(new Response('<b>Fatal error</b>', { status: 200 }));
    await expect(send()).resolves.toMatchObject({ kind: 'unknown' });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(send()).resolves.toMatchObject({ kind: 'unknown' });
  });

  const payOrder = () =>
    debitForOrder(ids, shop, { amount: 2500, description: 'Order ORD-1 (ORD-1-WABC)', orderId: 'ord_1', reference: 'ORD-1-WABC', orderReference: 'ORD-1', pin: '1234' });

  it('pays an order with one debit_wallet, naming the receiver and the order', async () => {
    answer(200, { success: true, transaction: { reference: 'TXN9' } });
    await expect(payOrder()).resolves.toMatchObject({ kind: 'sent', reference: 'TXN9' });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      action: 'debit_wallet',
      uuid_v4: 'u-from',
      uniq_id: 'FROM',
      receiver_uuid_v4: 'u-shop',
      receiver_uniq_id: 'SHOP',
      amount: 2500,
      description: 'Order ORD-1 (ORD-1-WABC)',
      order_id: 'ord_1',
      item_type: 'ecommerce_order',
      pin: '1234',
      metadata: { payment_reference: 'ORD-1-WABC', order_reference: 'ORD-1' },
    });
  });

  it('never reads "this order was already debited" as nothing moved', async () => {
    answer(200, { success: false, error_code: 'DUPLICATE_ORDER', message: 'Order already processed' });
    await expect(payOrder()).resolves.toMatchObject({ kind: 'unknown' });
    answer(200, { success: false, message: 'This order has already been paid' });
    await expect(payOrder()).resolves.toMatchObject({ kind: 'unknown' });
    answer(200, { success: false, error_code: 'INVALID_PIN', message: 'Incorrect PIN' });
    await expect(payOrder()).resolves.toMatchObject({ kind: 'refused', reason: 'wrong-pin' });
  });

  it('finds a transfer among the payer’s debits by our reference', async () => {
    const list = {
      success: true,
      transactions: [
        { reference: 'TXN2', type: 'credit', amount: 100, description: 'Refund (ORD-1-WABC)', status: 'completed' },
        { reference: 'TXN1', type: 'debit', amount: 2500, description: 'Order ORD-1 at Ada Fabrics (ORD-1-WABC)', status: 'completed' },
      ],
    };
    answer(200, list);
    await expect(findTransfer(ids, 'ORD-1-WABC')).resolves.toEqual({ state: 'completed', reference: 'TXN1' });
    answer(200, list);
    await expect(findTransfer(ids, 'ORD-1-WAB')).resolves.toBe('not-found');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(findTransfer(ids, 'ORD-1-WABC')).resolves.toBe('unavailable');
  });
});

describe('withdrawals (20.7)', () => {
  const ids = { uuid: 'u-shop', uniqId: 'SHOP' };
  const ask = () => requestWithdraw(ids, { amount: 5000, accountId: 7, description: 'Withdrawal to GTBank (WD-1)' });

  it('asks for a withdrawal, and reads each refusal EduPay listed', async () => {
    answer(200, { success: true, requires_otp: true, debug_otp: '123456', preview: { formatted_amount: '₦5,000.00' } });
    await expect(ask()).resolves.toEqual({ kind: 'code-sent' }); // the debug code goes no further
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      action: 'request_withdraw',
      uuid_v4: 'u-shop',
      uniq_id: 'SHOP',
      amount: 5000,
      account_id: 7,
      description: 'Withdrawal to GTBank (WD-1)',
    });

    answer(200, { success: false, message: 'Minimum withdrawal is ₦100', error_code: 'AMOUNT_TOO_LOW' });
    await expect(ask()).resolves.toMatchObject({ kind: 'refused', reason: 'too-low' });
    answer(200, { success: false, message: 'account_id is required', error_code: 'MISSING_ACCOUNT_ID' });
    await expect(ask()).resolves.toMatchObject({ kind: 'refused', reason: 'account-gone' });
    answer(200, { success: false, message: 'Bank account not found or inactive' });
    await expect(ask()).resolves.toMatchObject({ kind: 'refused', reason: 'account-gone' });
    answer(200, { success: false, message: 'Insufficient wallet balance', error_code: 'INSUFFICIENT_BALANCE', balance: 10, required: 5000 });
    await expect(ask()).resolves.toMatchObject({ kind: 'refused', reason: 'insufficient' });
    answer(200, { success: false, message: 'Failed to send OTP' });
    await expect(ask()).resolves.toMatchObject({ kind: 'refused', reason: 'code-not-sent' });
    answer(200, { success: false, message: 'Failed to send OTP', error_code: 'FAILED_TO_SEND_OTP' });
    await expect(ask()).resolves.toMatchObject({ kind: 'refused', reason: 'code-not-sent' });
  });

  it('reads a confirmation, and never a crash as "nothing moved"', async () => {
    answer(200, { success: true, transaction: { reference: 'TXN5' } });
    await expect(confirmWithdraw(ids, '123456')).resolves.toEqual({ kind: 'done', reference: 'TXN5' });
    answer(200, { success: false, message: 'Invalid OTP' });
    await expect(confirmWithdraw(ids, '000000')).resolves.toEqual({ kind: 'wrong-code' });
    answer(200, { success: false, message: 'OTP has expired' });
    await expect(confirmWithdraw(ids, '000000')).resolves.toEqual({ kind: 'expired' });
    answer(200, { success: false, error_code: 'INTERNAL_ERROR' });
    await expect(confirmWithdraw(ids, '123456')).resolves.toMatchObject({ kind: 'unknown' });
    fetchMock.mockResolvedValueOnce(new Response('<b>Fatal error</b>', { status: 200 }));
    await expect(confirmWithdraw(ids, '123456')).resolves.toMatchObject({ kind: 'unknown' });
  });

  it('finds what became of a withdrawal; a credit naming it means the money came back', async () => {
    const debit = { reference: 'TXN5', type: 'debit', amount: 5000, description: 'Withdrawal to GTBank (WD-1)', status: 'completed' };
    answer(200, { success: true, transactions: [debit] });
    await expect(withdrawalState(ids, 'WD-1')).resolves.toEqual({ state: 'completed', reference: 'TXN5' });
    answer(200, { success: true, transactions: [{ reference: 'TXN6', type: 'credit', amount: 5000, description: 'Reversal (WD-1)', status: 'completed' }, debit] });
    await expect(withdrawalState(ids, 'WD-1')).resolves.toEqual({ state: 'returned', reference: 'TXN6' });
    answer(200, { success: true, transactions: [debit] });
    await expect(withdrawalState(ids, 'WD-12')).resolves.toBe('not-found');
  });

  it('reads the bank accounts and auto-withdraw settings EduPay really sends', async () => {
    answer(200, { success: true, accounts: [{ id: 7, account_number: '0123456789', bank_code: '058', status: 'active' }, { id: 8, account_number: '999', bank_code: '058', is_active: false }], count: 2 });
    await expect(getBankAccounts(ids)).resolves.toEqual([
      { id: 7, accountNumber: '0123456789', bankCode: '058', active: true },
      { id: 8, accountNumber: '999', bankCode: '058', active: false },
    ]);
    // Seen on the test server, 2026-11-03.
    answer(200, { success: true, configured: false, settings: { auto_withdraw_enabled: false, schedule_time: '06:05:00', schedule_frequency: 'daily', min_withdrawal_amount: 100, max_withdrawal_amount: null, reserve_balance: 0, default_bank_account_id: null, notify_on_run: true }, last_run: null });
    await expect(getAutoWithdraw(ids)).resolves.toMatchObject({ enabled: false, frequency: 'daily', minAmount: 100, maxAmount: null, bankAccountId: null, notifyOnRun: true });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(getAutoWithdraw(ids)).resolves.toBeNull(); // can't be asked is not "off"
  });
});
