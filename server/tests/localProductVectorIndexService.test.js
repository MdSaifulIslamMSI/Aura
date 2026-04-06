const { __testables } = require('../services/ai/localProductVectorIndexService');

describe('localProductVectorIndexService helpers', () => {
    test('normalizeRetrievalFilters keeps valid filters and swaps inverted price bounds', () => {
        expect(__testables.normalizeRetrievalFilters({
            category: "Men's Fashion",
            brand: 'Dell',
            minPrice: 5000,
            maxPrice: 2000,
            minRating: 4.7,
            inStock: true,
            sortBy: 'price_asc',
        })).toEqual({
            category: "Men's Fashion",
            brand: 'Dell',
            minPrice: 2000,
            maxPrice: 5000,
            minRating: 4.7,
            inStock: true,
            sortBy: 'price_asc',
            requiredTerms: [],
        });
    });

    test('matchesProductFilters enforces budget, stock, rating, category, and required term constraints', () => {
        expect(__testables.matchesProductFilters({
            category: "Men's Fashion",
            brand: 'Dell',
            price: 1799,
            stock: 8,
            rating: 4.4,
            description: 'Blue cotton shirt with 16 GB smart spec badge',
        }, {
            category: "Men's Fashion",
            brand: 'Dell',
            maxPrice: 2000,
            minRating: 4,
            inStock: true,
            requiredTerms: ['blue', '16 gb'],
        })).toBe(true);

        expect(__testables.matchesProductFilters({
            category: "Men's Fashion",
            brand: 'Dell',
            price: 3200,
            stock: 0,
            rating: 3.8,
            description: 'Red shirt',
        }, {
            category: "Men's Fashion",
            brand: 'Dell',
            maxPrice: 2000,
            minRating: 4,
            inStock: true,
            requiredTerms: ['blue'],
        })).toBe(false);
    });

    test('keywordScore uses token matches instead of substring matches', () => {
        expect(__testables.keywordScore('phone', {
            title: 'iPhone Charger',
            category: 'Mobiles',
        })).toBe(0);

        expect(__testables.keywordScore('phone', {
            title: 'Android Phone',
            category: 'Mobiles',
        })).toBeGreaterThan(0);
    });

    test('sortRetrievedResults honors explicit sort preferences over raw score order', () => {
        const results = [
            { product: { id: 1, price: 14000, rating: 4.2, ratingCount: 10 }, score: 0.95 },
            { product: { id: 2, price: 9000, rating: 4.8, ratingCount: 22 }, score: 0.85 },
            { product: { id: 3, price: 11000, rating: 4.6, ratingCount: 30 }, score: 0.9 },
        ];

        expect(__testables.sortRetrievedResults(results, { sortBy: 'rating_desc' }).map((entry) => entry.product.id)).toEqual([2, 3, 1]);
        expect(__testables.sortRetrievedResults(results, { sortBy: 'price_asc' }).map((entry) => entry.product.id)).toEqual([2, 3, 1]);
    });
});
