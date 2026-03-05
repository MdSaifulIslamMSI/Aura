/**
 * Category configuration — single source of truth for category mapping.
 * Used by productController for URL-slug to DB-name resolution.
 */
const CATEGORY_MAP = {
    'mens-fashion': "Men's Fashion",
    'mens fashion': "Men's Fashion",
    "men's-fashion": "Men's Fashion",
    "men's fashion": "Men's Fashion",
    'womens-fashion': "Women's Fashion",
    'womens fashion': "Women's Fashion",
    "women's-fashion": "Women's Fashion",
    "women's fashion": "Women's Fashion",
    'home-kitchen': "Home & Kitchen",
    'home kitchen': "Home & Kitchen",
    'gaming': "Gaming & Accessories",
    'electronics': "Electronics",
    'mobiles': "Mobiles",
    'laptops': "Laptops",
    'books': "Books",
    'footwear': "Footwear"
};

/**
 * Resolve a URL slug or user input to the canonical DB category name.
 * Returns null if no mapping found.
 */
const resolveCategory = (input) => {
    if (!input || input === 'all' || input === 'undefined') return null;
    const normalized = input.toLowerCase().trim();
    return CATEGORY_MAP[normalized] || CATEGORY_MAP[input] || null;
};

module.exports = { CATEGORY_MAP, resolveCategory };
