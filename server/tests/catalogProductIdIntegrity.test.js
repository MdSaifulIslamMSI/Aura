const mongoose = require('mongoose');
const Product = require('../models/Product');
const ProductReview = require('../models/ProductReview');
const User = require('../models/User');
const SystemState = require('../models/SystemState');
const {
    createManualProduct,
    deleteManualProduct,
    ensureSystemState,
} = require('../services/catalogService');

const makePayload = (overrides = {}) => ({
    title: `Manual Widget ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    brand: 'AuraTestBrand',
    category: 'electronics',
    price: 999,
    image: `https://example.com/images/${Math.random().toString(36).slice(2, 10)}.jpg`,
    description: 'Manual product used by catalog id integrity tests',
    ...overrides,
});

const makeUser = async () => User.create({
    name: 'Catalog Integrity User',
    email: `catalog-id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    isVerified: true,
});

describe('catalog product id integrity', () => {
    beforeAll(async () => {
        await ensureSystemState();
        await Product.init();
    });

    test('unique index rejects duplicate numeric product ids', async () => {
        const payload = makePayload();
        const sharedId = 990001;

        await Product.create({
            ...payload,
            id: sharedId,
            externalId: `dup_test_${Math.random().toString(36).slice(2, 10)}`,
            source: 'manual',
        });

        await expect(Product.create({
            ...makePayload(),
            id: sharedId,
            externalId: `dup_test_${Math.random().toString(36).slice(2, 10)}`,
            source: 'manual',
        })).rejects.toMatchObject({ code: 11000 });
    });

    test('catalog rows without a numeric id coexist under the partial unique index', async () => {
        const first = await Product.create({
            ...makePayload(),
            externalId: `idless_${Math.random().toString(36).slice(2, 10)}`,
            source: 'batch',
        });
        const second = await Product.create({
            ...makePayload(),
            externalId: `idless_${Math.random().toString(36).slice(2, 10)}`,
            source: 'batch',
        });

        expect(first.id).toBeUndefined();
        expect(second.id).toBeUndefined();
        expect(first._id).not.toEqual(second._id);
    });

    test('createManualProduct re-allocates and succeeds when the counter id is already taken', async () => {
        const state = await SystemState.findOne({ key: 'singleton' });
        const nextCounterId = Number(state?.manualProductCounter || 1000000) + 1;

        // Occupy the exact id the allocator will hand out next.
        await Product.create({
            ...makePayload(),
            id: nextCounterId,
            externalId: `id_race_${Math.random().toString(36).slice(2, 10)}`,
            source: 'manual',
        });

        const product = await createManualProduct(makePayload());

        expect(product.id).toBeGreaterThan(nextCounterId);
    });

    test('deleteManualProduct archives instead of hard-deleting when reviews exist', async () => {
        const product = await createManualProduct(makePayload());
        const user = await makeUser();

        await ProductReview.create({
            product: product._id,
            user: user._id,
            rating: 5,
            comment: 'Integrity test review',
            status: 'published',
        });

        const result = await deleteManualProduct(product.id);

        expect(result.message).toMatch(/archived/i);
        const archived = await Product.findById(product._id).lean();
        expect(archived).toBeTruthy();
        expect(archived.isActive).toBe(false);
        expect(archived.isPublished).toBe(false);
    });

    test('deleteManualProduct hard-deletes when nothing references the product', async () => {
        const product = await createManualProduct(makePayload());

        const result = await deleteManualProduct(product.id);

        expect(result.message).toMatch(/removed/i);
        const removed = await Product.findById(product._id).lean();
        expect(removed).toBeNull();
    });
});
