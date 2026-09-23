import { PERMISSIONS, type PermissionKey } from './permissions';

const LABELS: Record<PermissionKey, string> = {
  // Inventory
  'inventory.view': 'View inventory',
  'inventory.create': 'Create items',
  'inventory.edit': 'Edit items',
  'inventory.delete': 'Delete items',
  'inventory.movement.create': 'Record movements',
  'inventory.adjustment.create': 'Make adjustments',
  'inventory.requisition.view': 'View requisitions',
  'inventory.requisition.create': 'Create requisitions',
  'inventory.requisition.approve': 'Approve requisitions',
  'inventory.category.manage': 'Manage categories',
  'inventory.kit.assemble': 'Assemble kits',
  'inventory.cycle_count.manage': 'Manage cycle counts',

  // Procurement
  'procurement.view': 'View purchase orders',
  'procurement.create': 'Create purchase orders',
  'procurement.edit': 'Edit purchase orders',
  'procurement.approve': 'Approve purchase orders',
  'procurement.reject': 'Reject purchase orders',
  'procurement.receive': 'Receive purchase orders',
  'supplier.view': 'View suppliers',
  'supplier.create': 'Create suppliers',
  'supplier.edit': 'Edit suppliers',

  // Projects
  'project.view': 'View projects',
  'project.create': 'Create projects',
  'project.edit': 'Edit projects',
  'project.delete': 'Delete projects',
  'task.view': 'View tasks',
  'task.create': 'Create tasks',
  'task.edit': 'Edit tasks',
  'task.assign': 'Assign tasks',

  // Sales
  'sales.view': 'View sales',
  'sales.order.create': 'Sell at the counter',
  'sales.quote.create': 'Create quotes',
  'sales.quote.edit': 'Edit quotes',
  'sales.invoice.create': 'Create invoices',
  'sales.invoice.edit': 'Edit invoices',
  'sales.invoice.void': 'Void invoices',
  'sales.return.manage': 'Manage returns',
  'sales.fulfillment.manage': 'Manage fulfillment (pick/pack/ship)',
  'sales.discount.manage': 'Create and edit discount codes',
  'sales.review.moderate': 'Hide and restore customer reviews',
  'sales.question.answer': 'Answer customer questions about products',
  'customer.view': 'View customers',
  'customer.create': 'Create customers',
  'customer.edit': 'Edit customers',

  // Social commerce
  'social.view': 'View connected social accounts',
  'social.manage': 'Connect and disconnect social accounts',

  // Staff / Settings
  'staff.view': 'View team members',
  'staff.invite': 'Invite members',
  'staff.manage': 'Manage members',
  'role.manage': 'Manage roles',
  'settings.view': 'View settings',
  'settings.edit': 'Edit settings',

  // Billing
  'billing.manage': 'Manage billing & subscription',
};

// Display name for each first-segment module
const MODULE_LABELS: Record<string, string> = {
  inventory: 'Inventory',
  procurement: 'Procurement',
  supplier: 'Suppliers',
  project: 'Projects',
  task: 'Tasks',
  sales: 'Sales',
  customer: 'Customers',
  social: 'Social commerce',
  staff: 'Staff',
  role: 'Roles',
  settings: 'Settings',
  billing: 'Billing',
};

export function getPermissionLabel(key: PermissionKey): string {
  return LABELS[key] ?? key;
}

export function getModuleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module.charAt(0).toUpperCase() + module.slice(1);
}

export function getPermissionsByModule(): Record<string, PermissionKey[]> {
  const result: Record<string, PermissionKey[]> = {};
  for (const key of Object.values(PERMISSIONS)) {
    const mod = key.split('.')[0];
    if (!result[mod]) result[mod] = [];
    result[mod].push(key);
  }
  return result;
}

export function getModules(): string[] {
  return [...new Set(Object.values(PERMISSIONS).map((k) => k.split('.')[0]))];
}
