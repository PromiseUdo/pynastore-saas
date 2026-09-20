import Image from 'next/image';
// lucide v1.16 dropped brand glyphs — fall back to the camera mark.
import { Camera } from 'lucide-react';
import { SectionHeader } from '@/components/storefront/common/section-header';

export function InstagramGrid({ posts }: { posts: { id: string; imageUrl: string; href: string }[] }) {
  if (!posts.length) return null;
  return (
    <section className="sf-container py-10 lg:py-14">
      <SectionHeader title="@yourstore on Instagram" subtitle="Tag us to be featured" align="center" />
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        {posts.map((post) => (
          <a
            key={post.id}
            href={post.href}
            className="group relative aspect-square overflow-hidden rounded-lg"
          >
            <Image
              src={post.imageUrl}
              alt=""
              fill
              sizes="(max-width:768px) 33vw, 16vw"
              className="object-cover transition-transform duration-500 group-hover:scale-110"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
              <Camera className="size-5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
