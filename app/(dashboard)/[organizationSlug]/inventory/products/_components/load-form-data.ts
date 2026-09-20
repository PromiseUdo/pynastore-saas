import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { listBrands, listCategories, listWarehouses } from '@/features/inventory/actions';
import { listSuppliers } from '@/features/procurement/actions';

/** Everything the product form's pickers need. Failures degrade to empty lists. */
export async function loadProductFormData(permissions: string[]) {
  const [categories, brands, warehouses, suppliers] = await Promise.all([
    listCategories(),
    listBrands(),
    listWarehouses(),
    hasPermission(permissions, PERMISSIONS.SUPPLIER_VIEW) ? listSuppliers() : null,
  ]);
  return {
    categories: categories.success ? categories.data : [],
    brands: brands.success ? brands.data : [],
    warehouses: warehouses.success ? warehouses.data : [],
    suppliers: suppliers?.success ? suppliers.data.map((s) => ({ id: s.id, name: s.name })) : [],
  };
}
