// features/inventory/actions.ts
// Barrel re-export — keep a single stable import path for all inventory
// server actions while the implementation is split by concern across
// categories.ts, items.ts, warehouses.ts, stock.ts, kits.ts, reports.ts,
// cycle-counts.ts, transfers.ts.
// No 'use server' directive here: each source file already carries its own,
// and a barrel that just forwards bindings doesn't need one.

export {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  moveCategory,
  type CategoryWithCounts,
  type CategoryInput,
} from './categories';

export { listStockableItems, type ItemListRow } from './items';

export {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  setProductPublished,
  getProductImageSearchStatus,
  retryProductImageSearch,
  type ProductListRow,
  type ProductListParams,
  type ProductListResult,
  type ProductDetail,
  type ProductInput,
  type StockState,
} from './products';

export { listBrands, createBrand, saveBrand, deleteBrand, type BrandRow, type BrandInput } from './brands';

export {
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  updateCollectionVisibility,
  deleteCollection,
  moveCollection,
  previewCollection,
  searchCollectionProducts,
  type CollectionListRow,
  type CollectionDetail,
  type CollectionInput,
  type CollectionProductRow,
} from './collections';

export {
  listWarehouses,
  createWarehouse,
  updateWarehouse,
  setWarehouseSellsOnline,
  type WarehouseRow,
} from './warehouses';

export {
  createStockMovement,
  recordStockIn,
  getProductStockUnits,
  getStockMovements,
  type StockInInput,
  type ProductStockUnits,
  type StockUnit,
  type MovementRow,
  type MovementListParams,
  type MovementListResult,
} from './stock';

export { createKit, assembleKit } from './kits';

export {
  getStockLevelsReport,
  getStockValuationReport,
  getLowStockReport,
  getLowStockLevels,
  getAgingInventoryReport,
  getSellThroughReport,
  getProfitabilityReport,
  type StockLevelRow,
  type ValuationReport,
  type ValuationRow,
  type LowStockRow,
  type AgingRow,
  type SellThroughRow,
  type ProfitabilityReport,
  type ProfitabilityRow,
} from './reports';

export {
  createCycleCount,
  listCycleCounts,
  getCycleCount,
  recordCounts,
  cancelCycleCount,
  completeCycleCount,
  type CycleCountListRow,
  type CycleCountItemRow,
  type CycleCountDetail,
} from './cycle-counts';

export {
  dispatchTransfer,
  receiveTransfer,
  cancelTransfer,
  listTransfers,
  type TransferRow,
} from './transfers';

export { getPutawayQueue, setItemLocation, type PutawayRow } from './putaway';
