// features/procurement/actions.ts
// Barrel re-export — single stable import path, mirrors features/inventory/actions.ts.
// No 'use server' directive here: each source file already carries its own.

export { listSuppliers, createSupplier, updateSupplier, type SupplierRow } from './suppliers';

export {
  createPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrder,
  submitForApproval,
  approvePurchaseOrder,
  rejectPurchaseOrder,
  markOrdered,
  markDropShipDelivered,
  cancelPurchaseOrder,
  receivePOLineItems,
  type POListRow,
  type POLineItemRow,
  type PODetail,
} from './purchase-orders';

export {
  previewReorderDrafts,
  generateReorderDrafts,
  type ReorderDraftGroup,
  type ReorderDraftItem,
} from './auto-reorder';

export {
  getSupplierPerformance,
  type SupplierPerformance,
  type CostHistoryPoint,
} from './supplier-performance';
