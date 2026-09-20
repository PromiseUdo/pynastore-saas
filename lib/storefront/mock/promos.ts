/*
 * Merchandising content for the homepage and site chrome — hero slides,
 * promo banners, testimonials, blog teasers, Instagram grid.
 */
import type { BlogTeaser, HeroSlide, PromoBanner, Testimonial } from '../types';
import { avatar, img } from './images';

export const HERO_SLIDES: HeroSlide[] = [
  {
    id: 'hero_1',
    eyebrow: 'New season',
    title: 'Everyday pieces, elevated',
    subtitle: 'Considered essentials across fashion, home and tech — built to last, priced to buy.',
    ctaLabel: 'Shop new arrivals',
    ctaHref: '/c/fashion?sort=newest',
    imageUrl: img('hero-fashion', 1920, 1080),
    align: 'left',
    theme: 'dark',
  },
  {
    id: 'hero_2',
    eyebrow: 'Tech event',
    title: 'Up to 25% off audio',
    subtitle: 'Orbit headphones, earbuds and speakers — this week only.',
    ctaLabel: 'Shop the sale',
    ctaHref: '/c/electronics/audio?tag=sale',
    imageUrl: img('hero-audio', 1920, 1080),
    align: 'right',
    theme: 'dark',
  },
  {
    id: 'hero_3',
    eyebrow: 'Home refresh',
    title: 'Make the space yours',
    subtitle: 'Furniture and décor that works as hard as you do.',
    ctaLabel: 'Explore Home & Living',
    ctaHref: '/c/home-living',
    imageUrl: img('hero-home', 1920, 1080),
    align: 'left',
    theme: 'light',
  },
];

export const SERVICE_FEATURES = [
  { icon: 'shield-check', title: 'Secure Payments', description: '100% safe & trusted' },
  { icon: 'truck', title: 'Nationwide Delivery', description: '2–4 working days' },
  { icon: 'badge-check', title: '100% Authentic', description: 'Genuine products only' },
  { icon: 'headphones', title: '24/7 Support', description: 'We are always here' },
  { icon: 'rotate-ccw', title: 'Easy Returns', description: 'Hassle free returns' },
];

export const PROMO_BANNERS: PromoBanner[] = [
  {
    id: 'promo_1',
    title: "Women's new-in",
    subtitle: 'The pieces we’re wearing on repeat',
    ctaLabel: 'Shop now',
    ctaHref: '/c/fashion/women',
    imageUrl: img('promo-women', 1200, 900),
    size: 'lg',
  },
  {
    id: 'promo_2',
    title: 'Beauty under ₦15,000',
    subtitle: 'Cult skincare, small prices',
    ctaLabel: 'Shop beauty',
    ctaHref: '/c/beauty?maxPrice=1500000',
    imageUrl: img('promo-beauty', 900, 600),
    size: 'sm',
  },
  {
    id: 'promo_3',
    title: 'Work-from-home setup',
    subtitle: 'Desks, chairs and monitors',
    ctaLabel: 'Shop the edit',
    ctaHref: '/c/home-living/furniture',
    imageUrl: img('promo-wfh', 900, 600),
    size: 'sm',
  },
];

export const TESTIMONIALS: Testimonial[] = [
  {
    id: 't1',
    author: 'Adaeze Okafor',
    role: 'Verified buyer',
    avatarUrl: avatar('adaeze'),
    quote: 'Delivery was faster than promised and the quality is genuinely a step above what I expected at this price.',
    rating: 5,
  },
  {
    id: 't2',
    author: 'Michael Boateng',
    role: 'Verified buyer',
    avatarUrl: avatar('michael'),
    quote: 'Had a sizing issue, the return was painless and the replacement arrived in two days. This is how it should work.',
    rating: 5,
  },
  {
    id: 't3',
    author: 'Halima Sule',
    role: 'Verified buyer',
    avatarUrl: avatar('halima'),
    quote: 'I’ve ordered four times now. The packaging is minimal, nothing has ever arrived damaged.',
    rating: 4,
  },
];

export const INSTAGRAM = Array.from({ length: 6 }, (_, i) => ({
  id: `ig_${i}`,
  imageUrl: img(`insta-${i}`, 600, 600),
  href: '#',
}));

export const BLOG_TEASERS: BlogTeaser[] = [
  {
    id: 'b1',
    slug: 'building-a-capsule-wardrobe',
    title: 'Building a capsule wardrobe that actually works',
    excerpt: 'Twelve pieces, dozens of outfits. Here’s the framework we use.',
    imageUrl: img('blog-capsule', 800, 600),
    date: '2026-08-14',
    category: 'Style',
  },
  {
    id: 'b2',
    slug: 'how-to-choose-headphones',
    title: 'Open-back vs closed-back: which headphones are right for you?',
    excerpt: 'A plain-English guide to picking cans for your space and habits.',
    imageUrl: img('blog-headphones', 800, 600),
    date: '2026-07-30',
    category: 'Tech',
  },
  {
    id: 'b3',
    slug: 'small-space-living-room',
    title: 'Five layout tricks for a small living room',
    excerpt: 'Make a compact space feel twice the size with these moves.',
    imageUrl: img('blog-livingroom', 800, 600),
    date: '2026-07-11',
    category: 'Home',
  },
];
