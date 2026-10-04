'use client';

/*
 * Online store → Customize: the page shell — header, the four tabs (kept in
 * the URL, AGENTS §3) and whichever one is open.
 *
 * All four stay mounted and the closed ones are hidden, so moving between
 * tabs never throws away edits that haven't been saved yet.
 */
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import type { DesignEditorData } from '@/features/storefront/design';
import type { HeroSlideRow } from '@/features/storefront/slides';
import { LookEditor } from './LookEditor';
import { SlidesPanel, type Destination } from './SlidesPanel';
import { HomepageEditor, type SourceOptions } from './HomepageEditor';
import { ChromeEditor } from './ChromeEditor';

export type CustomizeView = 'look' | 'homepage' | 'chrome' | 'slides';

const TABS = [
  { key: 'look', label: 'Look' },
  { key: 'homepage', label: 'Front page' },
  { key: 'chrome', label: 'Header & footer' },
  { key: 'slides', label: 'Slides' },
];

export function CustomizeClient({
  view,
  editor,
  slides,
  destinations,
  sourceOptions,
  storeUrl,
}: {
  view: CustomizeView;
  editor: DesignEditorData;
  slides: HeroSlideRow[];
  destinations: Destination[];
  sourceOptions: SourceOptions;
  storeUrl: string;
}) {
  return (
    <>
      <PageHeader
        title="Customize your store"
        description="Choose how your online shop looks and what greets customers on its front page."
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href={storeUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              Visit your store
            </a>
          </Button>
        }
      />
      <PageToolbar>
        <PageTabs tabs={TABS} current={view} />
      </PageToolbar>
      <PageBody className={view === 'homepage' || view === 'chrome' ? 'max-w-7xl' : 'max-w-5xl'}>
        <div hidden={view !== 'look'}>
          <LookEditor editor={editor} />
        </div>
        <div hidden={view !== 'homepage'}>
          <HomepageEditor
            editor={editor}
            options={sourceOptions}
            destinations={destinations}
            active={view === 'homepage'}
          />
        </div>
        <div hidden={view !== 'chrome'}>
          <ChromeEditor editor={editor} destinations={destinations} active={view === 'chrome'} />
        </div>
        <div hidden={view !== 'slides'}>
          <SlidesPanel slides={slides} destinations={destinations} />
        </div>
      </PageBody>
    </>
  );
}
