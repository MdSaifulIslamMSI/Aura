const { resolveCategory, CATEGORY_MAP } = require('../config/categories');

describe('Category Config Tests', () => {
    test('resolves standard category slugs', () => {
        expect(resolveCategory('mobiles')).toBe('Mobiles');
        expect(resolveCategory('laptops')).toBe('Laptops');
        expect(resolveCategory('electronics')).toBe('Electronics');
        expect(resolveCategory('gaming')).toBe('Gaming & Accessories');
    });

    test('resolves hyphenated category slugs', () => {
        expect(resolveCategory('mens-fashion')).toBe("Men's Fashion");
        expect(resolveCategory('womens-fashion')).toBe("Women's Fashion");
        expect(resolveCategory('home-kitchen')).toBe("Home & Kitchen");
    });

    test('resolves case-insensitively', () => {
        expect(resolveCategory('MOBILES')).toBe('Mobiles');
        expect(resolveCategory('Laptops')).toBe('Laptops');
        expect(resolveCategory('MENS-FASHION')).toBe("Men's Fashion");
    });

    test('returns null for unknown categories', () => {
        expect(resolveCategory('unknown-category')).toBeNull();
        expect(resolveCategory('')).toBeNull();
        expect(resolveCategory(null)).toBeNull();
        expect(resolveCategory(undefined)).toBeNull();
    });

    test('returns null for special values', () => {
        expect(resolveCategory('all')).toBeNull();
        expect(resolveCategory('undefined')).toBeNull();
    });

    test('CATEGORY_MAP has expected entries', () => {
        expect(Object.keys(CATEGORY_MAP).length).toBeGreaterThan(10);
        expect(CATEGORY_MAP['mobiles']).toBe('Mobiles');
    });
});
