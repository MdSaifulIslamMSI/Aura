import { describe, expect, it } from 'vitest';
import {
  CATALOG_CATEGORY_DEFINITIONS,
  CATALOG_CATEGORY_OPTIONS,
  DEFAULT_CATALOG_CATEGORY_LABELS,
  getCategoryApiValue,
  getCategoryLabel,
  getCategoryPath,
  getLocalizedCategoryLabel,
  normalizeCategorySlug,
  resolveCatalogCategory,
} from './catalogTaxonomy.js';

describe('catalogTaxonomy', () => {
  it('defines the full category list with unique slugs', () => {
    expect(CATALOG_CATEGORY_DEFINITIONS.length).toBe(9);
    const slugs = CATALOG_CATEGORY_DEFINITIONS.map((category) => category.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    CATALOG_CATEGORY_DEFINITIONS.forEach((category) => {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.apiValue.length).toBeGreaterThan(0);
      expect(category.aliases.length).toBeGreaterThan(0);
    });
  });

  it('derives select options and API labels from the same definitions', () => {
    expect(CATALOG_CATEGORY_OPTIONS).toEqual(
      CATALOG_CATEGORY_DEFINITIONS.map((category) => ({ value: category.slug, label: category.label }))
    );
    expect(DEFAULT_CATALOG_CATEGORY_LABELS).toEqual(
      CATALOG_CATEGORY_DEFINITIONS.map((category) => category.apiValue)
    );
  });

  it('resolves categories from slugs, labels, and aliases case-insensitively', () => {
    expect(resolveCatalogCategory('LAPTOPS').slug).toBe('laptops');
    expect(resolveCatalogCategory('notebook').slug).toBe('laptops');
    expect(resolveCatalogCategory("Men's Fashion").slug).toBe("men's-fashion");
    expect(resolveCatalogCategory('home & kitchen').slug).toBe('home-kitchen');
    expect(resolveCatalogCategory('spaceships')).toBeNull();
  });

  it('normalizes slugs and falls back to trimmed input for unknown api values', () => {
    expect(normalizeCategorySlug('smartphone')).toBe('mobiles');
    expect(normalizeCategorySlug('Bogus Category')).toBe('');
    expect(getCategoryApiValue('books')).toBe('Books');
    expect(getCategoryApiValue('  Bogus  ')).toBe('Bogus');
  });

  it('builds category routes with a products fallback', () => {
    expect(getCategoryPath('shoes')).toBe('/category/footwear');
    expect(getCategoryPath('bogus')).toBe('/products');
  });

  it('labels unknown values and uses the translator when available', () => {
    expect(getCategoryLabel('bogus-category')).toBe('Bogus Category');
    expect(getLocalizedCategoryLabel('books')).toBe('Books');
    expect(getLocalizedCategoryLabel('books', (key, values, fallback) => `T:${key}:${fallback}`))
      .toBe('T:category.books:Books');
  });
});
