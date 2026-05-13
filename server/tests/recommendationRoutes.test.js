const request = require('supertest');
const app = require('../index');
const Product = require('../models/Product');
const RecommendationEvent = require('../models/RecommendationEvent');

const imageFor = (id) => `https://example.com/recommendation-${id}.jpg`;

const createProduct = (overrides = {}) => Product.create({
    id: overrides.id,
    externalId: overrides.externalId || `rec-test-${overrides.id}`,
    title: overrides.title || `Product ${overrides.id}`,
    brand: overrides.brand || 'Aura',
    category: overrides.category || 'Mobiles',
    subCategory: overrides.subCategory || 'Smartphones',
    price: overrides.price || 19999,
    originalPrice: overrides.originalPrice || (overrides.price || 19999) + 2000,
    discountPercentage: overrides.discountPercentage ?? 10,
    rating: overrides.rating ?? 4.4,
    ratingCount: overrides.ratingCount ?? 120,
    stock: overrides.stock ?? 20,
    image: overrides.image || imageFor(overrides.id),
    images: [overrides.image || imageFor(overrides.id)],
    description: overrides.description || 'Recommendation test product',
    highlights: overrides.highlights || ['fast charging', 'good display'],
    tags: overrides.tags || [],
    isPublished: overrides.isPublished ?? true,
    isActive: overrides.isActive ?? true,
});

describe('recommendation routes', () => {
    test('tracks guest recommendation events with session identity', async () => {
        const phone = await createProduct({ id: 1001, title: 'Aura Phone Prime' });

        const response = await request(app)
            .post('/api/recommendation-events')
            .send({
                sessionId: 'guest-session-1',
                eventType: 'product_view',
                productId: phone.id,
                category: phone.category,
                sourcePage: 'product_detail',
                metadata: { path: '/product/1001' },
            });

        expect(response.statusCode).toBe(201);
        expect(response.body.success).toBe(true);

        const stored = await RecommendationEvent.findOne({ sessionId: 'guest-session-1' }).lean();
        expect(stored.eventType).toBe('product_view');
        expect(stored.productNumericId).toBe(1001);
    });

    test('returns similar products and excludes same, inactive, and out-of-stock products', async () => {
        await createProduct({ id: 1001, title: 'Aura Phone Prime', brand: 'Aura', price: 24000 });
        await createProduct({ id: 1002, title: 'Aura Phone Plus', brand: 'Aura', price: 24500, rating: 4.6 });
        await createProduct({ id: 1003, title: 'Aura Phone Empty Stock', stock: 0, price: 24200 });
        await createProduct({ id: 1004, title: 'Aura Phone Inactive', isActive: false, price: 24100 });
        await createProduct({ id: 2001, title: 'Everyday Sneakers', category: 'Footwear', subCategory: 'Shoes', brand: 'RunCo', price: 4999 });

        const response = await request(app)
            .get('/api/recommendations/similar/1001?limit=6&sessionId=guest-session-2');

        expect(response.statusCode).toBe(200);
        expect(response.body.success).toBe(true);
        const ids = response.body.recommendations.map((entry) => entry.product.id);
        expect(ids).toContain(1002);
        expect(ids).not.toContain(1001);
        expect(ids).not.toContain(1003);
        expect(ids).not.toContain(1004);
        expect(response.body.recommendations[0]).toHaveProperty('reason');
        expect(response.body.recommendations[0]).toHaveProperty('source');
    });

    test('ranks trending products from recent weighted events', async () => {
        const phone = await createProduct({ id: 1001, title: 'Aura Phone Prime', rating: 4.1 });
        const laptop = await createProduct({
            id: 3001,
            title: 'Aura Laptop Pro',
            category: 'Laptops',
            subCategory: 'Ultrabooks',
            brand: 'AuraBook',
            price: 62000,
            rating: 4.7,
        });

        await RecommendationEvent.create([
            { sessionId: 'trend-1', productId: phone._id, productNumericId: phone.id, eventType: 'product_view', sourcePage: 'home' },
            { sessionId: 'trend-1', productId: laptop._id, productNumericId: laptop.id, eventType: 'purchase', sourcePage: 'checkout' },
            { sessionId: 'trend-2', productId: laptop._id, productNumericId: laptop.id, eventType: 'add_to_cart', sourcePage: 'cart' },
        ]);

        const response = await request(app).get('/api/recommendations/trending?limit=4');

        expect(response.statusCode).toBe(200);
        expect(response.body.type).toBe('trending_products');
        expect(response.body.recommendations[0].product.id).toBe(3001);
    });

    test('returns cart add-ons and excludes products already in cart', async () => {
        await createProduct({ id: 1001, title: 'Aura Phone Prime', category: 'Mobiles', price: 24000 });
        await createProduct({ id: 1005, title: 'Phone Case Armor', category: 'Mobiles', subCategory: 'Accessories', price: 999, tags: ['case', 'cover'] });
        await createProduct({ id: 1006, title: 'Fast Charger Cable', category: 'Electronics', subCategory: 'Accessories', price: 1499, tags: ['charger', 'cable'] });

        const response = await request(app)
            .post('/api/recommendations/cart?sessionId=guest-cart')
            .send({
                cartItems: [{ productId: 1001, quantity: 1 }],
                limit: 6,
            });

        expect(response.statusCode).toBe(200);
        const ids = response.body.recommendations.map((entry) => entry.product.id);
        expect(ids).not.toContain(1001);
        expect(ids.some((id) => [1005, 1006].includes(id))).toBe(true);
    });

    test('assistant recommendation endpoint returns product reasons without exposing internals by default', async () => {
        const phone = await createProduct({ id: 1001, title: 'Aura Phone Prime', category: 'Mobiles', price: 24000 });
        await createProduct({ id: 1002, title: 'Aura Phone Lite', category: 'Mobiles', price: 18000 });
        await RecommendationEvent.create({
            sessionId: 'assistant-session',
            productId: phone._id,
            productNumericId: phone.id,
            eventType: 'purchase',
            sourcePage: 'checkout',
        });

        const response = await request(app)
            .post('/api/recommendations/assistant?sessionId=assistant-session')
            .send({
                message: 'suggest best phone under 30000',
                context: { page: 'assistant' },
                limit: 5,
            });

        expect(response.statusCode).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.type).toBe('assistant_recommendation');
        expect(response.body.recommendations.length).toBeGreaterThan(0);
        expect(response.body.recommendations[0]).toHaveProperty('reason');
        expect(response.body.recommendations[0]).not.toHaveProperty('debug');
    });
});
