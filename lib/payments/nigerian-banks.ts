/*
 * lib/payments/nigerian-banks.ts
 *
 * The banks a merchant can pick when adding a payout account, keyed by the
 * NIP institution code Squad's account lookup takes as `bank_code`.
 *
 * Client-safe (no secrets) — the settings dialog renders it and the server
 * action re-reads it, so the bank name we store always comes from here and
 * never from the browser. Add a bank by appending its NIP code; don't edit an
 * existing code, since saved accounts are matched back by name.
 */

export interface NigerianBank {
  /** NIP institution code */
  code: string;
  name: string;
}

export const NIGERIAN_BANKS: readonly NigerianBank[] = [
  { code: '000014', name: 'Access Bank' },
  { code: '000009', name: 'Citibank' },
  { code: '000010', name: 'Ecobank' },
  { code: '000007', name: 'Fidelity Bank' },
  { code: '000016', name: 'First Bank' },
  { code: '000003', name: 'FCMB' },
  { code: '000027', name: 'Globus Bank' },
  { code: '000013', name: 'GTBank' },
  { code: '000006', name: 'Jaiz Bank' },
  { code: '000002', name: 'Keystone Bank' },
  { code: '000029', name: 'Lotus Bank' },
  { code: '000036', name: 'Optimus Bank' },
  { code: '000008', name: 'Polaris Bank' },
  { code: '000031', name: 'PremiumTrust Bank' },
  { code: '000023', name: 'Providus Bank' },
  { code: '000034', name: 'Signature Bank' },
  { code: '000012', name: 'Stanbic IBTC' },
  { code: '000021', name: 'Standard Chartered' },
  { code: '000001', name: 'Sterling Bank' },
  { code: '000022', name: 'SunTrust Bank' },
  { code: '000026', name: 'TAJ Bank' },
  { code: '000025', name: 'Titan Trust Bank' },
  { code: '000018', name: 'Union Bank' },
  { code: '000004', name: 'UBA' },
  { code: '000011', name: 'Unity Bank' },
  { code: '000017', name: 'Wema Bank' },
  { code: '000015', name: 'Zenith Bank' },
  // Microfinance banks, payment service banks and mobile money operators
  { code: '120001', name: '9PSB' },
  { code: '100026', name: 'Carbon' },
  { code: '090551', name: 'FairMoney' },
  { code: '090267', name: 'Kuda' },
  { code: '090405', name: 'Moniepoint' },
  { code: '100004', name: 'OPay' },
  { code: '100002', name: 'Paga' },
  { code: '100033', name: 'PalmPay' },
  { code: '090325', name: 'Sparkle' },
  { code: '090110', name: 'VFD Microfinance Bank' },
];

export function bankByCode(code: string): NigerianBank | undefined {
  return NIGERIAN_BANKS.find((bank) => bank.code === code);
}

/** Best match for an account saved before banks were picked from this list. */
export function bankByName(name: string): NigerianBank | undefined {
  const wanted = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return NIGERIAN_BANKS.find((bank) => bank.name.toLowerCase().replace(/[^a-z0-9]/g, '') === wanted);
}
