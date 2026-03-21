import { expect } from '@playwright/test';

export const GUEST_CART_STORAGE_KEY = 'aura_cart_guest_v2';
export const GUEST_WISHLIST_STORAGE_KEY = 'aura_wishlist_guest_v2';

const DEFAULT_IMAGE = 'https://placehold.co/400x400/18181b/4ade80?text=Aura+Select';

export const createGuestCartItem = (overrides = {}) => ({
    id: 810001,
    title: 'Aura Flux Phone Max',
    brand: 'Aura',
    price: 54999,
    originalPrice: 62999,
    discountPercentage: 13,
    image: DEFAULT_IMAGE,
    stock: 8,
    deliveryTime: 'Tomorrow',
    quantity: 1,
    ...overrides,
});

export const createGuestWishlistItem = (overrides = {}) => ({
    id: 910001,
    title: 'Aura Pulse Buds Pro',
    brand: 'Aura',
    price: 7999,
    originalPrice: 9999,
    discountPercentage: 20,
    image: DEFAULT_IMAGE,
    stock: 12,
    rating: 4.5,
    ratingCount: 248,
    deliveryTime: '2-3 days',
    category: 'Electronics',
    addedAt: '2026-03-01T08:00:00.000Z',
    ...overrides,
});

export const seedGuestCommerceState = async (page, {
    cartItems = [],
    wishlistItems = [],
} = {}) => {
    const seedToken = `commerce-seed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    await page.addInitScript((payload) => {
        if (window.sessionStorage.getItem(payload.seedMarkerKey) === payload.seedToken) {
            return;
        }

        window.sessionStorage.setItem(payload.seedMarkerKey, payload.seedToken);
        window.localStorage.removeItem(payload.cartKey);
        window.localStorage.removeItem(payload.wishlistKey);

        if (Array.isArray(payload.cartItems) && payload.cartItems.length > 0) {
            window.localStorage.setItem(payload.cartKey, JSON.stringify(payload.cartItems));
        }

        if (Array.isArray(payload.wishlistItems) && payload.wishlistItems.length > 0) {
            window.localStorage.setItem(payload.wishlistKey, JSON.stringify(payload.wishlistItems));
        }
    }, {
        cartKey: GUEST_CART_STORAGE_KEY,
        wishlistKey: GUEST_WISHLIST_STORAGE_KEY,
        seedMarkerKey: '__aura_e2e_commerce_seed__',
        seedToken,
        cartItems,
        wishlistItems,
    });
};

export const waitForAppShell = async (page, path) => {
    await page.goto(path);
    await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15_000 });
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
};

export const mockProductDetailApis = async (page, {
    productId = 990001,
    product = {},
} = {}) => {
    const resolvedProduct = {
        id: Number(productId),
        title: 'Aura Flux Phone Max',
        displayTitle: 'Aura Flux Phone Max',
        subtitle: 'Flagship mobile commerce fixture',
        brand: 'Aura',
        rating: 4.7,
        ratingCount: 1824,
        price: 54999,
        originalPrice: 62999,
        discountPercentage: 13,
        stock: 8,
        image: DEFAULT_IMAGE,
        description: 'Deterministic product fixture for mobile commerce parity coverage.',
        highlights: ['120Hz display', 'Fast delivery', 'Guest cart compatible'],
        deliveryTime: 'Tomorrow',
        warranty: '1 year warranty',
        category: 'Mobiles',
        subCategory: '5G Smartphones',
        ...product,
    };

    const emptyReviewSummary = {
        averageRating: Number(resolvedProduct.rating || 0),
        totalReviews: Number(resolvedProduct.ratingCount || 0),
        withMediaCount: 0,
        ratingBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    };

    await page.route(`**/api/products/${productId}`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(resolvedProduct),
        });
    });

    await page.route(`**/api/products/${productId}/reviews**`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                reviews: [],
                summary: emptyReviewSummary,
            }),
        });
    });

    await page.route(`**/api/products/${productId}/compatibility**`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                groups: [],
            }),
        });
    });

    await page.route(`**/api/price-alerts/history/${productId}**`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                history: [],
            }),
        });
    });

    await page.route('**/api/products?**', async (route) => {
        const url = new URL(route.request().url());
        const category = url.searchParams.get('category');

        if (category && category.toLowerCase() === String(resolvedProduct.category || '').toLowerCase()) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    products: [],
                    total: 0,
                    page: 1,
                    pages: 1,
                }),
            });
            return;
        }

        await route.fallback();
    });

    return resolvedProduct;
};
