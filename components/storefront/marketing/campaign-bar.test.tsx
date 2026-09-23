// @vitest-environment jsdom
/*
 * The marquee's structure is what makes it seamless, so it is asserted here
 * rather than trusted: two identical groups in a content-sized track, moved
 * by exactly one group.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CampaignBar } from './campaign-bar';
import type { Announcement } from '@/lib/marketing/announcement';

vi.mock('next/link', () => ({
  /* Passes everything through — dropping props here would hide the very
   * thing under test (tabIndex on the repeated copies). */
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const announcement = (over: Partial<Announcement> = {}): Announcement => ({
  campaignId: 'c1',
  style: 'BAR',
  text: 'Christmas sale — 20% off',
  detail: null,
  cta: { label: 'Shop the sale', href: '/sale' },
  image: null,
  background: '#b42318',
  foreground: '#ffffff',
  scroll: true,
  ...over,
});

describe('CampaignBar, scrolling', () => {
  it('holds two identical groups in a track sized to its content', () => {
    const { container } = render(<CampaignBar announcement={announcement()} />);
    const track = container.querySelector('.sf-marquee')!;

    /* -50% of a content-sized track is exactly one group. Sized to the BAR
     * instead, it would be half the bar — which is what made the notice set
     * off from the middle and reappear there. */
    expect(track.className).toContain('w-max');
    expect(track.children).toHaveLength(2);
    expect(track.children[0].textContent).toBe(track.children[1].textContent);
  });

  it('gives each group at least a screen, so a short notice has no hole', () => {
    const { container } = render(<CampaignBar announcement={announcement()} />);
    const group = container.querySelector('.sf-marquee')!.children[0];
    expect(group.className).toContain('min-w-[100vw]');
  });

  it('reads the notice once, however many times it is shown', () => {
    render(<CampaignBar announcement={announcement()} />);
    const spoken = screen.getAllByText('Christmas sale — 20% off').filter(
      (el) => !el.closest('[aria-hidden="true"]'),
    );
    expect(spoken).toHaveLength(1);
  });

  it('makes every copy clickable, but only one tabbable', () => {
    /* Whichever copy is under the mouse is the one that gets clicked, so all
     * of them have to work. The repeats stay out of the keyboard's way with
     * tabindex="-1" — untabbable content inside aria-hidden is fine; it is
     * FOCUSABLE content that is the fault. */
    const { container } = render(<CampaignBar announcement={announcement()} />);
    const links = [...container.querySelectorAll('a')];
    expect(links.length).toBeGreaterThan(1);
    expect(links.every((a) => a.getAttribute('href') === '/sale')).toBe(true);

    const tabbable = links.filter((a) => a.getAttribute('tabindex') !== '-1');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].closest('[aria-hidden="true"]')).toBeNull();
  });
});

describe('previewing it', () => {
  /* jsdom's location is writable through history. */
  function at(search: string) {
    window.history.replaceState({}, '', `/${search}`);
  }

  it('shows even after it has been dismissed', () => {
    window.localStorage.setItem('sf-campaign-bar-dismissed', JSON.stringify(['c1']));

    at('');
    const normal = render(<CampaignBar announcement={announcement()} />);
    expect(normal.container.querySelector('.sf-marquee')).toBeNull();
    cleanup();

    /* The merchant who just wrote it should not have to clear site data to
     * look at their own shop. */
    at('?preview-announcement=1');
    const preview = render(<CampaignBar announcement={announcement()} />);
    expect(preview.container.querySelector('.sf-marquee')).not.toBeNull();

    window.localStorage.clear();
    at('');
  });

  it('leaves no record when it is closed', () => {
    at('?preview-announcement=1');
    render(<CampaignBar announcement={announcement()} />);
    screen.getByLabelText('Close announcement').click();

    // Closing a preview must not dismiss the real bar.
    expect(window.localStorage.getItem('sf-campaign-bar-dismissed')).toBeNull();
    at('');
  });
});

describe('CampaignBar, standing still', () => {
  it('shows the notice once with its link', () => {
    const { container } = render(<CampaignBar announcement={announcement({ scroll: false })} />);
    expect(container.querySelector('.sf-marquee')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(screen.getByText('Christmas sale — 20% off')).toBeTruthy();
  });
});
