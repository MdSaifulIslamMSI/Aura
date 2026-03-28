const CATEGORY_DEFINITIONS = [
    {
        slug: 'mobiles',
        label: 'Mobiles',
        apiValue: 'Mobiles',
        aliases: ['mobile', 'mobiles', 'phone', 'phones', 'smartphone', 'smartphones'],
    },
    {
        slug: 'laptops',
        label: 'Laptops',
        apiValue: 'Laptops',
        aliases: ['laptop', 'laptops', 'notebook', 'notebooks', 'macbook', 'ultrabook'],
    },
    {
        slug: 'electronics',
        label: 'Electronics',
        apiValue: 'Electronics',
        aliases: ['electronics', 'electronic', 'gadgets', 'gadget', 'audio', 'headphones'],
    },
    {
        slug: "men's-fashion",
        label: "Men's Fashion",
        apiValue: "Men's Fashion",
        aliases: ['mens-fashion', "men's-fashion", 'mens fashion', "men's fashion", 'menswear', 'menswear'],
    },
    {
        slug: "women's-fashion",
        label: "Women's Fashion",
        apiValue: "Women's Fashion",
        aliases: ['womens-fashion', "women's-fashion", 'womens fashion', "women's fashion", 'womenswear'],
    },
    {
        slug: 'footwear',
        label: 'Footwear',
        apiValue: 'Footwear',
        aliases: ['footwear', 'shoe', 'shoes', 'sneakers', 'sandals'],
    },
    {
        slug: 'home-kitchen',
        label: 'Home & Kitchen',
        apiValue: 'Home & Kitchen',
        aliases: ['home', 'kitchen', 'home-kitchen', 'home and kitchen', 'home & kitchen', 'appliances'],
    },
    {
        slug: 'gaming',
        label: 'Gaming',
        apiValue: 'Gaming & Accessories',
        aliases: ['gaming', 'games', 'game', 'gaming-accessories', 'gaming and accessories'],
    },
    {
        slug: 'books',
        label: 'Books',
        apiValue: 'Books',
        aliases: ['book', 'books', 'reading'],
    },
];

const normalizeCategoryKey = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const CATEGORY_LOOKUP = new Map();
const CATEGORY_LABEL_KEYS = {
    mobiles: 'category.mobiles',
    laptops: 'category.laptops',
    electronics: 'category.electronics',
    "men's-fashion": 'category.mensFashion',
    "women's-fashion": 'category.womensFashion',
    footwear: 'category.footwear',
    'home-kitchen': 'category.homeKitchen',
    gaming: 'category.gaming',
    books: 'category.books',
};

CATEGORY_DEFINITIONS.forEach((entry) => {
    [
        entry.slug,
        entry.label,
        entry.apiValue,
        ...(entry.aliases || []),
    ].forEach((variant) => {
        const key = normalizeCategoryKey(variant);
        if (key) {
            CATEGORY_LOOKUP.set(key, entry);
        }
    });
});

export const CATALOG_CATEGORY_DEFINITIONS = CATEGORY_DEFINITIONS;
export const CATALOG_CATEGORY_OPTIONS = CATEGORY_DEFINITIONS.map((entry) => ({
    value: entry.slug,
    label: entry.label,
}));
export const DEFAULT_CATALOG_CATEGORY_LABELS = CATEGORY_DEFINITIONS.map((entry) => entry.apiValue);

export const resolveCatalogCategory = (value) => {
    const normalized = normalizeCategoryKey(value);
    return CATEGORY_LOOKUP.get(normalized) || null;
};

export const normalizeCategorySlug = (value) => resolveCatalogCategory(value)?.slug || '';

export const getCategoryApiValue = (value) => resolveCatalogCategory(value)?.apiValue || String(value || '').trim();

export const getCategoryLabel = (value) => resolveCatalogCategory(value)?.label || String(value || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();

export const getLocalizedCategoryLabel = (value, translate) => {
    const resolved = resolveCatalogCategory(value);
    const fallback = resolved?.label || getCategoryLabel(value);
    const key = resolved ? CATEGORY_LABEL_KEYS[resolved.slug] : '';

    if (typeof translate !== 'function' || !key) {
        return fallback;
    }

    return translate(key, {}, fallback);
};

export const getCategoryPath = (value) => {
    const slug = normalizeCategorySlug(value);
    return slug ? `/category/${slug}` : '/products';
};
