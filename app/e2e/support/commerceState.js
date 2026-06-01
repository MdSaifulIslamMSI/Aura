import { expect } from '@playwright/test';

export const GUEST_CART_STORAGE_KEY = 'aura_cart_guest_v2';
export const GUEST_WISHLIST_STORAGE_KEY = 'aura_wishlist_guest_v2';

const DEFAULT_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"%3E%3Crect width="400" height="400" fill="%2318181b"/%3E%3Ccircle cx="200" cy="180" r="82" fill="%234ade80" opacity="0.9"/%3E%3Ctext x="200" y="298" text-anchor="middle" font-family="Arial" font-size="34" font-weight="700" fill="%23f8fafc"%3EAura Select%3C/text%3E%3C/svg%3E';

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
        try {
            if (window.sessionStorage?.getItem(payload.seedMarkerKey) === payload.seedToken) {
                return;
            }
        } catch {
            // Continue with best-effort localStorage seeding when this browser context denies sessionStorage.
        }

        try {
            window.sessionStorage?.setItem(payload.seedMarkerKey, payload.seedToken);
        } catch {
            // The test fixtures should still work in storage-restricted browser contexts.
        }

        try {
            window.localStorage?.removeItem(payload.cartKey);
            window.localStorage?.removeItem(payload.wishlistKey);

            if (Array.isArray(payload.cartItems) && payload.cartItems.length > 0) {
                window.localStorage?.setItem(payload.cartKey, JSON.stringify(payload.cartItems));
            }

            if (Array.isArray(payload.wishlistItems) && payload.wishlistItems.length > 0) {
                window.localStorage?.setItem(payload.wishlistKey, JSON.stringify(payload.wishlistItems));
            }
        } catch {
            // Ignore storage write failures; tests that depend on seeded state will assert visible behavior.
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

    await page.route('**/api/products/**', async (route) => {
        const url = new URL(route.request().url());
        if (!url.pathname.endsWith(`/api/products/${productId}`)) {
            await route.fallback();
            return;
        }

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
