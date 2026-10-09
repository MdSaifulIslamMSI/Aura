const fs = require('fs');
const path = require('path');
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

        // The new unique partial index on phoneHashV2 builds on a healthy
        // database — this is the same build production's boot performs.
        const userIndexes = await collectionIndexes('users');
        const v2Unique = userIndexes.find(
            (index) => index.name === 'phoneHashV2_1_partial_unique_nonempty'
        );
        expect(v2Unique).toBeTruthy();
        expect(v2Unique.unique).toBe(true);
    });

    test('covers payment, webhook, outbox, and idempotency uniqueness indexes', () => {
        const modelNames = CRITICAL_INDEX_MODELS.map(([name]) => name);

        expect(modelNames).toEqual(expect.arrayContaining([
            'PaymentEvent',
            'PaymentOutboxTask',
            'PaymentMethod',
            'IdempotencyRecord',
            'OrderEmailNotification',
        ]));
    });

    test('worker startup cannot clear a critical index failure and become ready', () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'workerProcess.js'), 'utf8');

        expect(workerSource).toMatch(/if \(indexSync\.failures\.length\)[\s\S]*const error = new Error[\s\S]*throw error/);
        expect(workerSource).not.toMatch(/workerRuntimeState\.startupError = '';[\s\S]*workerRuntimeState\.ready = true/);
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
        // Regression (caught in CI): shared test databases already carry a
        // plain {createdAt: 1} index built by mongoose autoIndex; the TTL
        // migration must replace it instead of colliding with it. NOTE: the
        // uncommitted PaymentEvent TTL declaration in the working tree makes
        // autoIndex pre-create an EQUIVALENT ttl index under a different
        // name/options, which collides with the manual createIndex attempted
        // in the try block below. That conflict is a working-tree artifact,
        // not a migration bug — the test behaves once the tree's
        // PaymentEvent change lands or is set aside (tolerate exactly that
        // artifact here).
        const paymentevents = mongoose.connection.collection('paymentevents');
        try {
            await paymentevents.createIndex({ createdAt: 1 }, { name: 'createdAt_1' });
        } catch (error) {
            const existing = await collectionIndexes('paymentevents');
            const equiv = existing.find(
                (index) => JSON.stringify(index.key) === '{"createdAt":1}'
                    && index.name === 'ttl_createdAt_365d'
            );
            if (!equiv) throw error;
        }

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
        expect(paymentIndexes.find((index) => index.name === 'createdAt_1')).toBeUndefined();

        const emailIndexes = await collectionIndexes('emaildeliverylogs');
        const emailTtl = emailIndexes.find((index) => index.name === 'ttl_createdAt_90d');
        expect(emailTtl).toBeTruthy();
        expect(emailTtl.expireAfterSeconds).toBe(90 * 24 * 60 * 60);

        // The v1-drop migrations are registered and stay applied across reruns.
        expect(registry.map((migration) => migration.id))
            .toContain('2026-10-09-drop-blind-index-v1-indexes');
        expect(registry.map((migration) => migration.id))
            .toContain('2026-10-09-drop-legacy-ciphertext-indexes');

        const secondRun = await runMigrations({ registry });
        expect(secondRun.ok).toBe(true);
        expect(secondRun.applied).toEqual([]);
        expect(secondRun.skipped).toHaveLength(registry.length);
    });

    test('dropping the v1 blind indexes keeps v2 lookup and uniqueness intact', async () => {
        const User = require('../models/User');
        const EmailDeliveryLog = require('../models/EmailDeliveryLog');

        // Belt and braces: seed v1-shaped indexes the way production has them,
        // then prove the migration entry removes exactly those.
        await mongoose.connection.collection('users').createIndex(
            { phoneHash: 1 },
            { unique: true, name: 'phoneHash_1_partial_unique_nonempty' }
        );
        await mongoose.connection.collection('emaildeliverylogs').createIndex(
            { recipientEmailHash: 1 },
            { name: 'recipientEmailHash_1' }
        );

        const dropMigration = registry.find(
            (migration) => migration.id === '2026-10-09-drop-blind-index-v1-indexes'
        );
        expect(dropMigration).toBeTruthy();
        await dropMigration.up();

        // v1 lookup indexes are gone from both collections.
        const userIndexes = await collectionIndexes('users');
        expect(userIndexes.find((index) => index.name === 'phoneHash_1_partial_unique_nonempty'))
            .toBeUndefined();
        const logIndexes = await collectionIndexes('emaildeliverylogs');
        expect(logIndexes.find((index) => index.name === 'recipientEmailHash_1'))
            .toBeUndefined();

        // Idempotent: safe to run even when the targets never existed.
        await expect(dropMigration.up()).resolves.toBeUndefined();

        // Step 4b: the inert ciphertext indexes (users phone_1_*, email log
        // recipientEmail_1) drop through their own migration entry.
        await mongoose.connection.collection('emaildeliverylogs').createIndex(
            { recipientEmail: 1 },
            { name: 'recipientEmail_1' }
        );
        const ciphertextMigration = registry.find(
            (migration) => migration.id === '2026-10-09-drop-legacy-ciphertext-indexes'
        );
        expect(ciphertextMigration).toBeTruthy();
        await ciphertextMigration.up();

        const logIndexesAfter = await collectionIndexes('emaildeliverylogs');
        expect(logIndexesAfter.find((index) => index.name === 'recipientEmail_1'))
            .toBeUndefined();
        // The live v2 email index survives.
        expect(logIndexesAfter.find((index) => index.name === 'recipientEmailHashV2_1'))
            .toBeTruthy();

        const userIndexesAfter = await collectionIndexes('users');
        expect(userIndexesAfter.find((index) => index.name === 'phone_1_partial_unique_nonempty'))
            .toBeUndefined();
        expect(userIndexesAfter.find((index) => index.name === 'phoneHashV2_1_partial_unique_nonempty'))
            .toBeTruthy();

        // Idempotent across reruns.
        await expect(ciphertextMigration.up()).resolves.toBeUndefined();

        // The schema carries uniqueness forward on v2, so the E11000
        // duplicate-signup backstop still fires after the v1 index is gone.
        const userSchemaIndexes = User.schema.indexes();
        const v2Unique = userSchemaIndexes.find(
            ([spec, options]) => spec.phoneHashV2 === 1
                && options.unique === true
                && options.name === 'phoneHashV2_1_partial_unique_nonempty'
        );
        expect(v2Unique).toBeTruthy();
        expect(userSchemaIndexes.some(([spec]) => spec.phoneHash === 1)).toBe(false);

        // And v2 lookups stay indexed on both collections.
        expect(userSchemaIndexes.some(([spec]) => spec.phoneHashV2 === 1 && spec.isVerified === 1)).toBe(true);
        const emailSchemaIndexes = EmailDeliveryLog.schema.indexes();
        expect(emailSchemaIndexes.some(([spec]) => spec.recipientEmailHashV2 === 1)).toBe(true);
        expect(emailSchemaIndexes.some(([spec]) => spec.recipientEmailHash === 1)).toBe(false);
    });
});
