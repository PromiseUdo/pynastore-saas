import { redirect } from 'next/navigation';

/** Items were renamed Products (one catalogue for stock and the online store). */
export default function ItemsPage() {
  redirect('/inventory/products');
}
