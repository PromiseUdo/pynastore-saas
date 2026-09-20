/*
 * Dummy brands. Names are invented to avoid trademark entanglements while
 * reading like a real multi-category marketplace.
 */
import type { Brand } from '../types';
import { img } from './images';

const RAW: [slug: string, name: string, description: string][] = [
  ['aeris', 'Aeris', 'Considered essentials in natural fibres.'],
  ['northbound', 'Northbound', 'Performance outerwear built for the outdoors.'],
  ['lumen', 'Lumen', 'Consumer electronics with a design-first approach.'],
  ['forge', 'Forge & Co.', 'Hard-wearing tools and workwear.'],
  ['petal', 'Petal', 'Clean skincare backed by dermatology.'],
  ['maison-verte', 'Maison Verte', 'French-inspired home and table.'],
  ['orbit', 'Orbit Audio', 'Studio-grade sound for everyday listening.'],
  ['juniper', 'Juniper', 'Playful, durable kidswear.'],
  ['atlas', 'Atlas Supply', 'Travel bags and carry goods.'],
  ['sable', 'Sable', 'Modern fragrance, unisex by design.'],
  ['harvest-lane', 'Harvest Lane', 'Small-batch pantry and beverages.'],
  ['kova', 'Kova', 'Minimalist furniture for smaller spaces.'],
  ['pixl', 'Pixl', 'Cameras and creator gear.'],
  ['solene', 'Solène', 'Occasion-ready womenswear.'],
];

export const BRANDS: Brand[] = RAW.map(([slug, name, description]) => ({
  id: `brand_${slug}`,
  slug,
  name,
  description,
  logoUrl: img(`brand-${slug}`, 240, 120),
}));

export const BRAND_BY_ID = new Map(BRANDS.map((b) => [b.id, b]));
export const BRAND_BY_SLUG = new Map(BRANDS.map((b) => [b.slug, b]));
