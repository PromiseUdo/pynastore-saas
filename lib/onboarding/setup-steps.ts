/*
 * lib/onboarding/setup-steps.ts
 *
 * The "Get your shop ready" steps (ROADMAP 12.5): what each is, why it
 * matters, where it's done, who can do it, and the order to show them in.
 * Pure and client-safe. Whether a step is DONE is never stored — it is read
 * from the real records by ./setup-guide.ts, so the guide can't claim
 * something that isn't so.
 *
 * Required steps are the ones a shop can't take an online order without;
 * "Open your shop" is offered once they're all done. Being paid online is
 * recommended rather than required, because pay on delivery always works.
 */
import type { PermissionKey } from '@/lib/permissions';
import type { SalesChannels } from './business';

export type SetupStepKey =
  | 'store_place'
  | 'sells_online'
  | 'delivery'
  | 'product'
  | 'payment'
  | 'open'
  | 'logo'
  | 'store_pages'
  | 'domain';

export interface SetupStepInfo {
  title: string;
  /** one line: why it matters */
  why: string;
  href: string;
  action: string;
  /** a second way to do it, e.g. importing instead of adding one by one */
  secondary?: { label: string; href: string };
  /** needed before the shop can open */
  required: boolean;
  /** shown under "Optional" */
  optional: boolean;
  permission: PermissionKey;
}

export const SETUP_STEPS: Record<SetupStepKey, SetupStepInfo> = {
  store_place: {
    title: 'Say where your store is',
    why: 'Delivery prices and times are worked out from the city and state your stock leaves from.',
    href: '/inventory/warehouses',
    action: 'Set the place',
    required: true,
    optional: false,
    permission: 'inventory.edit',
  },
  sells_online: {
    title: 'Sell from a store online',
    why: 'Only stock in a store that sells online appears in your online shop.',
    href: '/inventory/warehouses',
    action: 'Turn on',
    required: true,
    optional: false,
    permission: 'inventory.edit',
  },
  delivery: {
    title: 'Set up delivery or pickup',
    why: 'Shoppers can’t check out until your store can deliver or offer pickup.',
    href: '/settings/delivery',
    action: 'Set up delivery',
    required: true,
    optional: false,
    permission: 'settings.edit',
  },
  product: {
    title: 'Add a product with stock',
    why: 'Your shop shows products that are published and in stock at a store that sells online.',
    href: '/inventory/products/new',
    action: 'Add a product',
    secondary: { label: 'Import from a spreadsheet', href: '/inventory/products/import' },
    required: true,
    optional: false,
    permission: 'inventory.create',
  },
  payment: {
    title: 'Choose how you get paid',
    why: 'Pay on delivery always works. Add online payments or a bank account so shoppers can pay before delivery.',
    href: '/settings/payments',
    action: 'Set up payments',
    required: false,
    optional: false,
    permission: 'settings.edit',
  },
  open: {
    title: 'Open your shop',
    why: 'Until then shoppers see “Opening soon” and can’t order.',
    href: '/settings/setup',
    action: 'Open your shop',
    required: false,
    optional: false,
    permission: 'settings.edit',
  },
  logo: {
    title: 'Add your logo',
    why: 'It appears on your shop, your invoices and your emails.',
    href: '/settings',
    action: 'Add a logo',
    required: false,
    optional: true,
    permission: 'settings.edit',
  },
  store_pages: {
    title: 'Write your store pages',
    why: 'Shoppers look for who you are and how delivery and returns work before they buy.',
    href: '/settings/pages',
    action: 'Write pages',
    required: false,
    optional: true,
    permission: 'settings.edit',
  },
  domain: {
    title: 'Use your own web address',
    why: 'Customers find you at yourshop.com.',
    href: '/settings/domain',
    action: 'See options',
    required: false,
    optional: true,
    permission: 'billing.manage',
  },
};

/** The order the steps are shown in — by what the merchant said they do. */
export function stepOrder(channels: SalesChannels | null): SetupStepKey[] {
  const optional: SetupStepKey[] = ['logo', 'store_pages', 'domain'];
  if (channels === 'IN_PERSON') {
    // Their till comes first; the online shop can wait.
    return ['store_place', 'product', 'payment', 'sells_online', 'delivery', 'open', ...optional];
  }
  return ['store_place', 'sells_online', 'delivery', 'product', 'payment', 'open', ...optional];
}

export interface SetupStep extends SetupStepInfo {
  key: SetupStepKey;
  done: boolean;
}

export interface SetupProgress {
  steps: SetupStep[];
  /** every required step done — the shop may be opened */
  readyToOpen: boolean;
  isOpen: boolean;
  /** required steps done / required steps */
  requiredDone: number;
  requiredTotal: number;
  /** the first step not done, required or recommended, excluding optional ones */
  next: SetupStep | null;
  /** nothing left to do but optional extras */
  complete: boolean;
}

export function summarize(done: Record<SetupStepKey, boolean>, channels: SalesChannels | null): SetupProgress {
  const steps = stepOrder(channels).map((key) => ({ key, ...SETUP_STEPS[key], done: done[key] }));
  const required = steps.filter((s) => s.required);
  const requiredDone = required.filter((s) => s.done).length;
  const readyToOpen = requiredDone === required.length;
  const next = steps.find((s) => !s.done && !s.optional) ?? null;
  return {
    steps,
    readyToOpen,
    isOpen: done.open,
    requiredDone,
    requiredTotal: required.length,
    next,
    complete: next === null,
  };
}
