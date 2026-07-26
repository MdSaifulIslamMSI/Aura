const AccountCenterMigrationRun = require('../models/AccountCenterMigrationRun');
const AccountPrivacyJob = require('../models/AccountPrivacyJob');
const Listing = require('../models/Listing');
const PriceAlert = require('../models/PriceAlert');
const ProductReview = require('../models/ProductReview');
const TradeIn = require('../models/TradeIn');
const User = require('../models/User');

const indexNames = (model) => model.schema.indexes()
    .map(([, options]) => options?.name)
    .filter(Boolean);

describe('account center database indexes', () => {
    test.each([
        [Listing, 'listing_owner_history'],
        [ProductReview, 'product_review_owner_history'],
        [TradeIn, 'trade_in_owner_history'],
        [PriceAlert, 'price_alert_owner_history'],
    ])('%p declares its owner history index', (model, expectedName) => {
        expect(indexNames(model)).toContain(expectedName);
    });

    test('privacy jobs and migration runs expose their operational indexes', () => {
        expect(indexNames(AccountPrivacyJob)).toEqual(expect.arrayContaining([
            'account_privacy_job_idempotency_unique',
            'account_privacy_job_owner_history',
            'account_privacy_job_worker_queue',
        ]));
        expect(indexNames(AccountCenterMigrationRun)).toContain('account_center_migration_status');
    });

    test('new accounts default to schema version two', () => {
        const path = User.schema.path('accountCenterSchemaVersion');
        expect(path.options).toMatchObject({
            default: 2,
            min: 1,
            max: 2,
        });
    });
});
