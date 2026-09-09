const mongoose = require('mongoose');
const { runMigrations } = require('../migrations/runner');
const { registry } = require('../migrations');
const { syncCriticalIndexes, CRITICAL_INDEX_MODELS } = require('../services/indexIntegrityService');

jest.setTimeout(30000);

const collectionIndexes = async (name) => {
    const indexes = await mongoose.connection.collection(name).indexes();
    return indexes;
};

describe('critical index integrity sync', () => {
    test('syncs every critical model without failure on a healthy database', async () => {
        const result = await syncCriticalIndexes();
        expect(result.failures).toEqual([]);
        expect(result.synced).toHaveLength(CRITICAL_INDEX_MODELS.length);
        expect(result.synced).toContain('CouponRedemption');
    });

    test('reports failures instead of throwing when a unique index cannot build', async () => {
        // Seed a real duplicate (same code + same user) that violates the
        // coupon once-per-user backstop, then drop the index so the sync has
        // to rebuild it.
        const collection = mongoose.connection.collection('couponredemptions');
        const user = new mongoose.Types.ObjectId();
        await collection.dropIndex('coupon_code_user_unique').catch(() => {});
        await collection.insertMany([
            { code: 'DUPCODE', user, discount: 1 },
            { code: 'DUPCODE', user, discount: 1 },
        ]);

        const result = await syncCriticalIndexes();

        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].model).toBe('CouponRedemption');

        // Clean the dupes so the migration suite below can rebuild the index.
        await collection.deleteMany({ code: 'DUPCODE' });
    });
});

describe('migration registry', () => {
    test('applies the coupon backstop and TTL indexes once, then skips on rerun', async () => {
        const firstRun = await runMigrations({ registry });
        expect(firstRun.ok).toBe(true);
        expect(firstRun.applied).toHaveLength(registry.length);

        const couponIndexes = await collectionIndexes('couponredemptions');
        const couponUnique = couponIndexes.find((index) => index.name === 'coupon_code_user_unique');
        expect(couponUnique).toBeTruthy();
        expect(couponUnique.unique).toBe(true);

        const paymentIndexes = await collectionIndexes('paymentevents');
        const paymentTtl = paymentIndexes.find((index) => index.name === 'ttl_createdAt_365d');
        expect(paymentTtl).toBeTruthy();
        expect(paymentTtl.expireAfterSeconds).toBe(365 * 24 * 60 * 60);

        const emailIndexes = await collectionIndexes('emaildeliverylogs');
        const emailTtl = emailIndexes.find((index) => index.name === 'ttl_createdAt_90d');
        expect(emailTtl).toBeTruthy();
        expect(emailTtl.expireAfterSeconds).toBe(90 * 24 * 60 * 60);

        const secondRun = await runMigrations({ registry });
        expect(secondRun.ok).toBe(true);
        expect(secondRun.applied).toEqual([]);
        expect(secondRun.skipped).toHaveLength(registry.length);
    });
});
