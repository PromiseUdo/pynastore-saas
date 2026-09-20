/*
 * The DEMO store's "goes well with" settings — fixture data, like the
 * products beside it.
 *
 * A real store's pairings are the merchant's own: each category's
 * "Goes well with" list in Inventory › Categories (Category.companionIds),
 * loaded by lib/storefront/data/from-prisma.ts. This file feeds only
 * lib/storefront/data/from-fixtures.ts, which maps these slugs to ids so the
 * engine sees one shape whichever source it runs on.
 *
 * Keyed by CATEGORY, never by product, for the same reason the real setting
 * is: a new laptop picks up its accessories without anyone hand-picking them.
 */

export interface CompanionRule {
  /** heading for the rail on a product in this category */
  title: string;
  /** category slugs to pull companions from, best first */
  categories: string[];
}

export const COMPANIONS: Record<string, CompanionRule> = {
  /* Fashion */
  dresses: { title: 'Complete the look', categories: ['bags', 'jewellery', 'sunglasses', 'watches'] },
  tops: { title: 'Complete the look', categories: ['skirts', 'trousers', 'jewellery', 'bags'] },
  skirts: { title: 'Complete the look', categories: ['tops', 'bags', 'jewellery'] },
  outerwear: { title: 'Complete the look', categories: ['bags', 'sunglasses', 'watches'] },
  'activewear-w': { title: 'Complete the workout', categories: ['yoga', 'weights', 'earbuds'] },
  shirts: { title: 'Complete the look', categories: ['trousers', 'watches', 'jackets'] },
  tshirts: { title: 'Complete the look', categories: ['trousers', 'jackets', 'sunglasses'] },
  trousers: { title: 'Complete the look', categories: ['shirts', 'tshirts', 'watches'] },
  jackets: { title: 'Complete the look', categories: ['tshirts', 'trousers', 'sunglasses'] },
  sneakers: { title: 'Complete the look', categories: ['activewear-w', 'tshirts', 'bags', 'sunglasses'] },
  boots: { title: 'Complete the look', categories: ['jackets', 'outerwear', 'trousers'] },
  sandals: { title: 'Complete the look', categories: ['sunglasses', 'bags', 'dresses'] },
  bags: { title: 'Pairs well with', categories: ['sunglasses', 'watches', 'jewellery'] },
  watches: { title: 'Pairs well with', categories: ['shirts', 'jewellery', 'sunglasses'] },
  sunglasses: { title: 'Pairs well with', categories: ['bags', 'watches', 'tshirts'] },
  jewellery: { title: 'Pairs well with', categories: ['dresses', 'tops', 'bags'] },

  /* Electronics */
  laptops: { title: 'You may also need', categories: ['keyboards-mice', 'monitors', 'headphones', 'bags'] },
  monitors: { title: 'You may also need', categories: ['keyboards-mice', 'laptops', 'tables'] },
  'keyboards-mice': { title: 'You may also need', categories: ['monitors', 'laptops', 'tables'] },
  smartphones: { title: 'You may also need', categories: ['phone-cases', 'earbuds', 'speakers'] },
  tablets: { title: 'You may also need', categories: ['phone-cases', 'headphones', 'keyboards-mice'] },
  'phone-cases': { title: 'You may also need', categories: ['smartphones', 'earbuds'] },
  headphones: { title: 'You may also need', categories: ['laptops', 'earbuds', 'speakers'] },
  earbuds: { title: 'You may also need', categories: ['smartphones', 'phone-cases', 'yoga'] },
  speakers: { title: 'You may also need', categories: ['smartphones', 'headphones'] },
  mirrorless: { title: 'You may also need', categories: ['action-cams', 'bags', 'storage'] },
  'action-cams': { title: 'You may also need', categories: ['helmets', 'tents', 'bike-accessories'] },

  /* Home */
  sofas: { title: 'Finish the room', categories: ['rugs', 'lighting', 'wall-art', 'storage'] },
  chairs: { title: 'Finish the room', categories: ['tables', 'rugs', 'lighting'] },
  tables: { title: 'Finish the room', categories: ['chairs', 'tableware', 'lighting'] },
  storage: { title: 'Finish the room', categories: ['wall-art', 'lighting', 'rugs'] },
  cookware: { title: 'You may also need', categories: ['tableware', 'small-appliances', 'oils'] },
  'small-appliances': { title: 'You may also need', categories: ['coffee', 'cookware', 'tableware'] },
  tableware: { title: 'Finish the table', categories: ['tables', 'cookware', 'chairs'] },
  lighting: { title: 'Finish the room', categories: ['rugs', 'wall-art', 'chairs'] },
  rugs: { title: 'Finish the room', categories: ['lighting', 'sofas', 'wall-art'] },
  'wall-art': { title: 'Finish the room', categories: ['lighting', 'rugs', 'storage'] },
  duvets: { title: 'Finish the bed', categories: ['pillows', 'lighting'] },
  pillows: { title: 'Finish the bed', categories: ['duvets', 'lighting'] },

  /* Beauty */
  cleansers: { title: 'Build the routine', categories: ['serums', 'moisturisers', 'suncare'] },
  serums: { title: 'Build the routine', categories: ['moisturisers', 'cleansers', 'suncare'] },
  moisturisers: { title: 'Build the routine', categories: ['serums', 'suncare', 'cleansers'] },
  suncare: { title: 'Build the routine', categories: ['moisturisers', 'cleansers'] },
  face: { title: 'Complete the look', categories: ['lips', 'eyes', 'moisturisers'] },
  lips: { title: 'Complete the look', categories: ['face', 'eyes'] },
  eyes: { title: 'Complete the look', categories: ['face', 'lips'] },
  'women-fragrance': { title: 'Pairs well with', categories: ['face', 'jewellery', 'moisturisers'] },
  'men-fragrance': { title: 'Pairs well with', categories: ['styling', 'watches', 'shirts'] },
  shampoo: { title: 'Build the routine', categories: ['styling', 'cleansers'] },
  styling: { title: 'Build the routine', categories: ['shampoo', 'men-fragrance'] },

  /* Grocery */
  coffee: { title: 'Goes well with', categories: ['small-appliances', 'chocolate', 'nuts'] },
  tea: { title: 'Goes well with', categories: ['chocolate', 'nuts', 'tableware'] },
  juices: { title: 'Goes well with', categories: ['nuts', 'chocolate'] },
  chocolate: { title: 'Goes well with', categories: ['coffee', 'tea', 'nuts'] },
  nuts: { title: 'Goes well with', categories: ['chocolate', 'juices', 'tea'] },
  oils: { title: 'You may also need', categories: ['pasta-grains', 'cookware'] },
  'pasta-grains': { title: 'You may also need', categories: ['oils', 'cookware'] },

  /* Toys, sports, jewelry */
  'brick-sets': { title: 'You may also like', categories: ['model-kits', 'board-games', 'jigsaw-puzzles'] },
  'model-kits': { title: 'You may also like', categories: ['brick-sets', 'jigsaw-puzzles'] },
  'board-games': { title: 'You may also like', categories: ['jigsaw-puzzles', 'brick-sets', 'chocolate'] },
  'jigsaw-puzzles': { title: 'You may also like', categories: ['board-games', 'tea'] },
  'ride-ons': { title: 'You may also need', categories: ['helmets', 'water-play'] },
  'water-play': { title: 'You may also like', categories: ['ride-ons', 'board-games'] },
  weights: { title: 'You may also need', categories: ['yoga', 'earbuds', 'activewear-w'] },
  yoga: { title: 'You may also need', categories: ['weights', 'activewear-w', 'earbuds'] },
  tents: { title: 'You may also need', categories: ['sleeping-bags', 'bike-accessories', 'action-cams'] },
  'sleeping-bags': { title: 'You may also need', categories: ['tents', 'action-cams'] },
  helmets: { title: 'You may also need', categories: ['bike-accessories', 'action-cams'] },
  'bike-accessories': { title: 'You may also need', categories: ['helmets', 'action-cams'] },
  necklaces: { title: 'Pairs well with', categories: ['earrings', 'rings', 'stacking-sets'] },
  rings: { title: 'Pairs well with', categories: ['stacking-sets', 'necklaces', 'earrings'] },
  earrings: { title: 'Pairs well with', categories: ['necklaces', 'rings'] },
  'bridal-sets': { title: 'Pairs well with', categories: ['earrings', 'necklaces', 'women-fragrance'] },
  'stacking-sets': { title: 'Pairs well with', categories: ['rings', 'necklaces'] },
};
