// lib/permissions.ts
// Typed permission system — all permission keys defined here as constants.
// Seed these into the database; never hard-code strings elsewhere.

export const PERMISSIONS = {
  // ─── Inventory ───────────────────────────────────────────
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_CREATE: 'inventory.create',
  INVENTORY_EDIT: 'inventory.edit',
  INVENTORY_DELETE: 'inventory.delete',
  INVENTORY_MOVEMENT_CREATE: 'inventory.movement.create',
  INVENTORY_ADJUSTMENT_CREATE: 'inventory.adjustment.create',
  INVENTORY_REQUISITION_VIEW: 'inventory.requisition.view',
  INVENTORY_REQUISITION_CREATE: 'inventory.requisition.create',
  INVENTORY_REQUISITION_APPROVE: 'inventory.requisition.approve',
  INVENTORY_CATEGORY_MANAGE: 'inventory.category.manage',
  INVENTORY_KIT_ASSEMBLE: 'inventory.kit.assemble',
  INVENTORY_CYCLE_COUNT_MANAGE: 'inventory.cycle_count.manage',

  // ─── Procurement ─────────────────────────────────────────
  PROCUREMENT_VIEW: 'procurement.view',
  PROCUREMENT_CREATE: 'procurement.create',
  PROCUREMENT_EDIT: 'procurement.edit',
  PROCUREMENT_APPROVE: 'procurement.approve',
  PROCUREMENT_REJECT: 'procurement.reject',
  PROCUREMENT_RECEIVE: 'procurement.receive',
  SUPPLIER_VIEW: 'supplier.view',
  SUPPLIER_CREATE: 'supplier.create',
  SUPPLIER_EDIT: 'supplier.edit',

  // ─── Projects ────────────────────────────────────────────
  PROJECT_VIEW: 'project.view',
  PROJECT_CREATE: 'project.create',
  PROJECT_EDIT: 'project.edit',
  PROJECT_DELETE: 'project.delete',
  TASK_VIEW: 'task.view',
  TASK_CREATE: 'task.create',
  TASK_EDIT: 'task.edit',
  TASK_ASSIGN: 'task.assign',

  // ─── Sales ───────────────────────────────────────────────
  SALES_VIEW: 'sales.view',
  SALES_QUOTE_CREATE: 'sales.quote.create',
  SALES_QUOTE_EDIT: 'sales.quote.edit',
  SALES_INVOICE_CREATE: 'sales.invoice.create',
  SALES_INVOICE_EDIT: 'sales.invoice.edit',
  SALES_INVOICE_VOID: 'sales.invoice.void',
  SALES_RETURN_MANAGE: 'sales.return.manage',
  SALES_FULFILLMENT_MANAGE: 'sales.fulfillment.manage',
  SALES_DISCOUNT_MANAGE: 'sales.discount.manage',
  SALES_REVIEW_MODERATE: 'sales.review.moderate',
  CUSTOMER_VIEW: 'customer.view',
  CUSTOMER_CREATE: 'customer.create',
  CUSTOMER_EDIT: 'customer.edit',

  // ─── Social commerce ─────────────────────────────────────
  SOCIAL_VIEW: 'social.view',
  SOCIAL_MANAGE: 'social.manage',

  // ─── Staff / Settings ────────────────────────────────────
  STAFF_VIEW: 'staff.view',
  STAFF_INVITE: 'staff.invite',
  STAFF_MANAGE: 'staff.manage',
  ROLE_MANAGE: 'role.manage',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_EDIT: 'settings.edit',

  // ─── Billing ─────────────────────────────────────────────
  BILLING_MANAGE: 'billing.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ─── Permission Check Helpers ─────────────────────────────────────────────────

/**
 * Check if a user has a specific permission.
 * Use in server actions and server components.
 *
 * @example
 * const ctx = await getOrganizationContext();
 * requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_APPROVE);
 */
export function hasPermission(
  userPermissions: string[],
  required: PermissionKey,
): boolean {
  return userPermissions.includes(required);
}

/**
 * Throws an error if the user lacks the required permission.
 * Use at the top of server actions.
 */
export function requirePermission(
  userPermissions: string[],
  required: PermissionKey,
): void {
  if (!hasPermission(userPermissions, required)) {
    throw new PermissionDeniedError(required);
  }
}

export class PermissionDeniedError extends Error {
  constructor(permission: PermissionKey) {
    super(`Permission denied: ${permission}`);
    this.name = 'PermissionDeniedError';
  }
}

// ─── Default System Roles ─────────────────────────────────────────────────────
// Seed these on org creation. Users can create custom roles on top.

export const SYSTEM_ROLES = {
  OWNER: {
    name: 'Owner',
    isSystem: true,
    permissions: Object.values(PERMISSIONS),
  },
  ADMIN: {
    name: 'Admin',
    isSystem: true,
    permissions: Object.values(PERMISSIONS),
  },
  WAREHOUSE_MANAGER: {
    name: 'Warehouse Manager',
    isSystem: true,
    permissions: [
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.INVENTORY_CREATE,
      PERMISSIONS.INVENTORY_EDIT,
      PERMISSIONS.INVENTORY_MOVEMENT_CREATE,
      PERMISSIONS.INVENTORY_ADJUSTMENT_CREATE,
      PERMISSIONS.INVENTORY_REQUISITION_VIEW,
      PERMISSIONS.INVENTORY_REQUISITION_APPROVE,
      PERMISSIONS.INVENTORY_CATEGORY_MANAGE,
      PERMISSIONS.INVENTORY_KIT_ASSEMBLE,
      PERMISSIONS.INVENTORY_CYCLE_COUNT_MANAGE,
      PERMISSIONS.PROCUREMENT_RECEIVE,
      PERMISSIONS.SALES_VIEW,
      PERMISSIONS.SALES_FULFILLMENT_MANAGE,
    ],
  },
  PROCUREMENT_OFFICER: {
    name: 'Procurement Officer',
    isSystem: true,
    permissions: [
      PERMISSIONS.PROCUREMENT_VIEW,
      PERMISSIONS.PROCUREMENT_CREATE,
      PERMISSIONS.PROCUREMENT_EDIT,
      PERMISSIONS.PROCUREMENT_RECEIVE,
      PERMISSIONS.SUPPLIER_VIEW,
      PERMISSIONS.SUPPLIER_CREATE,
      PERMISSIONS.SUPPLIER_EDIT,
      PERMISSIONS.INVENTORY_VIEW,
    ],
  },
  SALES_REPRESENTATIVE: {
    name: 'Sales Representative',
    isSystem: true,
    permissions: [
      PERMISSIONS.SALES_VIEW,
      PERMISSIONS.SALES_QUOTE_CREATE,
      PERMISSIONS.SALES_QUOTE_EDIT,
      PERMISSIONS.SALES_INVOICE_CREATE,
      PERMISSIONS.SALES_INVOICE_EDIT,
      PERMISSIONS.SALES_RETURN_MANAGE,
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.CUSTOMER_CREATE,
      PERMISSIONS.CUSTOMER_EDIT,
      PERMISSIONS.SOCIAL_VIEW,
    ],
  },
  PROJECT_MANAGER: {
    name: 'Project Manager',
    isSystem: true,
    permissions: [
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.PROJECT_CREATE,
      PERMISSIONS.PROJECT_EDIT,
      PERMISSIONS.TASK_VIEW,
      PERMISSIONS.TASK_CREATE,
      PERMISSIONS.TASK_EDIT,
      PERMISSIONS.TASK_ASSIGN,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.INVENTORY_REQUISITION_CREATE,
    ],
  },
  VIEWER: {
    name: 'Viewer',
    isSystem: true,
    permissions: [
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.PROCUREMENT_VIEW,
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.TASK_VIEW,
      PERMISSIONS.SALES_VIEW,
      PERMISSIONS.CUSTOMER_VIEW,
    ],
  },
} as const;
