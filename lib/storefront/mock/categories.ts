/*
 * Category tree for the dummy storefront — up to 3 levels deep
 * (e.g. Fashion > Women > Skirts). Authored as a nested literal; the
 * flat `CATEGORIES` array with computed `path`/`level`/`parentId` is
 * derived from it at module load.
 */
import type { Category } from '../types';
import { img } from './images';

interface RawCategory {
  slug: string;
  name: string;
  description?: string;
  featured?: boolean;
  children?: RawCategory[];
}

const TREE: RawCategory[] = [
  {
    slug: 'fashion',
    name: 'Fashion & Clothing',
    featured: true,
    description: 'Apparel, footwear and accessories for every occasion.',
    children: [
      {
        slug: 'women',
        name: "Women's",
        children: [
          { slug: 'dresses', name: 'Dresses' },
          { slug: 'tops', name: 'Tops & Blouses' },
          { slug: 'skirts', name: 'Skirts' },
          { slug: 'outerwear', name: 'Coats & Jackets' },
          { slug: 'activewear-w', name: 'Activewear' },
        ],
      },
      {
        slug: 'men',
        name: "Men's",
        children: [
          { slug: 'shirts', name: 'Shirts' },
          { slug: 'tshirts', name: 'T‑Shirts & Polos' },
          { slug: 'trousers', name: 'Trousers & Chinos' },
          { slug: 'jackets', name: 'Jackets' },
        ],
      },
      {
        slug: 'kids',
        name: 'Kids',
        children: [
          { slug: 'girls', name: 'Girls' },
          { slug: 'boys', name: 'Boys' },
          { slug: 'baby', name: 'Baby' },
        ],
      },
      {
        slug: 'shoes',
        name: 'Shoes',
        children: [
          { slug: 'sneakers', name: 'Sneakers & Trainers' },
          { slug: 'boots', name: 'Boots' },
          { slug: 'sandals', name: 'Sandals & Slides' },
        ],
      },
      {
        slug: 'accessories',
        name: 'Accessories',
        children: [
          { slug: 'bags', name: 'Bags' },
          { slug: 'watches', name: 'Watches' },
          { slug: 'sunglasses', name: 'Sunglasses' },
          { slug: 'jewellery', name: 'Jewellery' },
        ],
      },
    ],
  },
  {
    slug: 'electronics',
    name: 'Electronics',
    featured: true,
    description: 'The latest devices, audio and accessories.',
    children: [
      {
        slug: 'phones-tablets',
        name: 'Phones & Tablets',
        children: [
          { slug: 'smartphones', name: 'Smartphones' },
          { slug: 'tablets', name: 'Tablets' },
          { slug: 'phone-cases', name: 'Cases & Protection' },
        ],
      },
      {
        slug: 'computers',
        name: 'Computers',
        children: [
          { slug: 'laptops', name: 'Laptops' },
          { slug: 'monitors', name: 'Monitors' },
          { slug: 'keyboards-mice', name: 'Keyboards & Mice' },
        ],
      },
      {
        slug: 'audio',
        name: 'Audio',
        children: [
          { slug: 'headphones', name: 'Headphones' },
          { slug: 'earbuds', name: 'Earbuds' },
          { slug: 'speakers', name: 'Speakers' },
        ],
      },
      {
        slug: 'cameras',
        name: 'Cameras',
        children: [
          { slug: 'mirrorless', name: 'Mirrorless' },
          { slug: 'action-cams', name: 'Action Cameras' },
        ],
      },
    ],
  },
  {
    slug: 'home-living',
    name: 'Home & Living',
    featured: true,
    description: 'Furniture, kitchenware and décor to make it yours.',
    children: [
      {
        slug: 'furniture',
        name: 'Furniture',
        children: [
          { slug: 'sofas', name: 'Sofas' },
          { slug: 'chairs', name: 'Chairs' },
          { slug: 'tables', name: 'Tables & Desks' },
          { slug: 'storage', name: 'Storage' },
        ],
      },
      {
        slug: 'kitchen',
        name: 'Kitchen',
        children: [
          { slug: 'cookware', name: 'Cookware' },
          { slug: 'small-appliances', name: 'Small Appliances' },
          { slug: 'tableware', name: 'Tableware' },
        ],
      },
      {
        slug: 'decor',
        name: 'Décor',
        children: [
          { slug: 'lighting', name: 'Lighting' },
          { slug: 'rugs', name: 'Rugs' },
          { slug: 'wall-art', name: 'Wall Art' },
        ],
      },
      {
        slug: 'bedding',
        name: 'Bedding',
        children: [
          { slug: 'duvets', name: 'Duvets & Sets' },
          { slug: 'pillows', name: 'Pillows' },
        ],
      },
    ],
  },
  {
    slug: 'beauty',
    name: 'Beauty & Personal Care',
    featured: true,
    description: 'Skincare, makeup and fragrance from cult favourites.',
    children: [
      {
        slug: 'skincare',
        name: 'Skincare',
        children: [
          { slug: 'cleansers', name: 'Cleansers' },
          { slug: 'serums', name: 'Serums' },
          { slug: 'moisturisers', name: 'Moisturisers' },
          { slug: 'suncare', name: 'Suncare' },
        ],
      },
      {
        slug: 'makeup',
        name: 'Makeup',
        children: [
          { slug: 'face', name: 'Face' },
          { slug: 'lips', name: 'Lips' },
          { slug: 'eyes', name: 'Eyes' },
        ],
      },
      {
        slug: 'fragrance',
        name: 'Fragrance',
        children: [
          { slug: 'women-fragrance', name: 'For Her' },
          { slug: 'men-fragrance', name: 'For Him' },
        ],
      },
      {
        slug: 'hair',
        name: 'Hair',
        children: [
          { slug: 'shampoo', name: 'Shampoo & Conditioner' },
          { slug: 'styling', name: 'Styling' },
        ],
      },
    ],
  },
  {
    slug: 'grocery',
    name: 'Grocery & Essentials',
    featured: true,
    description: 'Everyday essentials and specialty treats.',
    children: [
      {
        slug: 'beverages',
        name: 'Beverages',
        children: [
          { slug: 'coffee', name: 'Coffee' },
          { slug: 'tea', name: 'Tea' },
          { slug: 'juices', name: 'Juices' },
        ],
      },
      {
        slug: 'snacks',
        name: 'Snacks',
        children: [
          { slug: 'chocolate', name: 'Chocolate' },
          { slug: 'nuts', name: 'Nuts & Trail Mix' },
        ],
      },
      {
        slug: 'pantry',
        name: 'Pantry',
        children: [
          { slug: 'oils', name: 'Oils & Vinegars' },
          { slug: 'pasta-grains', name: 'Pasta & Grains' },
        ],
      },
    ],
  },
  {
    slug: 'toys-games',
    name: 'Toys & Games',
    featured: true,
    description: 'Play, build and learn — for every age.',
    children: [
      {
        slug: 'building-sets',
        name: 'Building & Construction',
        children: [
          { slug: 'brick-sets', name: 'Brick Sets' },
          { slug: 'model-kits', name: 'Model Kits' },
        ],
      },
      {
        slug: 'games-puzzles',
        name: 'Games & Puzzles',
        children: [
          { slug: 'board-games', name: 'Board Games' },
          { slug: 'jigsaw-puzzles', name: 'Jigsaw Puzzles' },
        ],
      },
      {
        slug: 'outdoor-play',
        name: 'Outdoor Play',
        children: [
          { slug: 'ride-ons', name: 'Ride-Ons & Scooters' },
          { slug: 'water-play', name: 'Water & Sand Play' },
        ],
      },
    ],
  },
  {
    slug: 'sports-outdoors',
    name: 'Sports & Outdoors',
    featured: true,
    description: 'Training, trail and everything in between.',
    children: [
      {
        slug: 'fitness',
        name: 'Fitness & Training',
        children: [
          { slug: 'weights', name: 'Weights & Kettlebells' },
          { slug: 'yoga', name: 'Yoga & Recovery' },
        ],
      },
      {
        slug: 'camping',
        name: 'Camping & Hiking',
        children: [
          { slug: 'tents', name: 'Tents & Shelters' },
          { slug: 'sleeping-bags', name: 'Sleeping Bags' },
        ],
      },
      {
        slug: 'cycling',
        name: 'Cycling',
        children: [
          { slug: 'helmets', name: 'Helmets' },
          { slug: 'bike-accessories', name: 'Bike Accessories' },
        ],
      },
    ],
  },
  {
    slug: 'jewelry',
    name: 'Jewelry & Accessories',
    featured: true,
    description: 'Fine and everyday pieces, made to be worn.',
    children: [
      {
        slug: 'fine-jewelry',
        name: 'Fine Jewelry',
        children: [
          { slug: 'necklaces', name: 'Necklaces' },
          { slug: 'rings', name: 'Rings' },
          { slug: 'earrings', name: 'Earrings' },
        ],
      },
      {
        slug: 'jewelry-sets',
        name: 'Sets & Bridal',
        children: [
          { slug: 'bridal-sets', name: 'Bridal Sets' },
          { slug: 'stacking-sets', name: 'Stacking Sets' },
        ],
      },
    ],
  },
];

function flatten(): Category[] {
  const out: Category[] = [];
  const walk = (
    nodes: RawCategory[],
    parentId: string | null,
    parentPath: string[],
    level: number,
  ) => {
    for (const node of nodes) {
      const id = `cat_${node.slug}`;
      const path = [...parentPath, node.slug];
      out.push({
        id,
        slug: node.slug,
        name: node.name,
        parentId,
        level,
        path,
        description: node.description ?? `Shop ${node.name}.`,
        imageUrl: img(`cat-${node.slug}`, 640, 480),
        featured: node.featured ?? false,
      });
      if (node.children) walk(node.children, id, path, level + 1);
    }
  };
  walk(TREE, null, [], 0);
  return out;
}

export const CATEGORIES: Category[] = flatten();

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

/** All ancestor ids for a category id, closest-last (excludes self). */
export function ancestorIds(categoryId: string): string[] {
  const chain: string[] = [];
  let current = CATEGORY_BY_ID.get(categoryId);
  while (current?.parentId) {
    chain.unshift(current.parentId);
    current = CATEGORY_BY_ID.get(current.parentId);
  }
  return chain;
}

/** Self + all descendant ids. */
export function subtreeIds(categoryId: string): string[] {
  const ids = [categoryId];
  const stack = [categoryId];
  while (stack.length) {
    const parent = stack.pop()!;
    for (const c of CATEGORIES) {
      if (c.parentId === parent) {
        ids.push(c.id);
        stack.push(c.id);
      }
    }
  }
  return ids;
}
