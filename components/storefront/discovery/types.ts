/*
 * Serialisable option shapes handed from the server page down into the
 * client discovery components, so those components never import the
 * catalogue (and never become a second route into tenant data).
 */
export interface RootCategoryOption {
  id: string;
  name: string;
  path: string[];
  productCount: number;
}

export interface PriceBandOption {
  id: string;
  label: string;
  minPrice?: number;
  maxPrice?: number;
  productCount: number;
}
