import { describe, expect, it } from 'vitest';
import {
  getTrustPageContent,
  trustContent,
  trustMeta,
  trustRouteToKey,
  trustRoutes,
} from './trustContent.js';

describe('trustContent', () => {
  it('maps trust routes to content keys and derives routes from the map', () => {
    expect(trustRoutes).toEqual(Object.keys(trustRouteToKey));
    expect(trustRouteToKey['/security']).toBe('security');
    expect(trustRouteToKey['/return-policy']).toBe('return-policy');
    expect(trustRouteToKey['/bogus']).toBeUndefined();
  });

  it('gives every route key a fully-shaped content page (and vice versa)', () => {
    expect([...new Set(Object.values(trustRouteToKey))].sort())
      .toEqual(Object.keys(trustContent).sort());
    Object.values(trustContent).forEach((page) => {
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.summary.length).toBeGreaterThan(0);
      expect(page.sections.length).toBeGreaterThan(0);
      page.sections.forEach((section) => {
        expect(section.heading.length).toBeGreaterThan(0);
        expect(section.points.length).toBeGreaterThan(0);
        section.points.forEach((point) => expect(point.length).toBeGreaterThan(0));
      });
      expect(page.cta.to).toMatch(/^\//);
      expect(page.cta.label.length).toBeGreaterThan(0);
    });
  });

  it('falls back to the security page for unknown keys', () => {
    expect(getTrustPageContent('bogus')).toBe(trustContent.security);
    expect(getTrustPageContent().title).toBe('Security');
  });

  it('formats localized content through intl when provided', () => {
    const requestedIds = [];
    const intl = {
      formatMessage: (descriptor) => {
        requestedIds.push(descriptor.id);
        return `Localized: ${descriptor.defaultMessage}`;
      },
    };
    const localized = getTrustPageContent('security', intl);
    expect(localized.title).toBe('Localized: Security');
    expect(localized.sections[0].heading).toBe('Localized: Account Protection');
    expect(localized.cta.label).toBe('Localized: Contact Security Support');
    expect(requestedIds).toContain('trust.security.title');
    expect(localized.sections).toHaveLength(trustContent.security.sections.length);
  });

  it('exposes the content last-updated stamp', () => {
    expect(trustMeta.lastUpdated).toBe('March 1, 2026');
  });
});
