// Production runs with autoIndex disabled, and boot-time syncs previously
// covered only Product/SystemState. Model-defined integrity indexes (unique
// backstops like the coupon once-per-user rule) therefore never existed in
// production unless created by hand. This pass builds any missing indexes on
// the models whose indexes carry correctness or auth guarantees.
const logger = require('../utils/logger');
const CouponRedemption = require('../models/CouponRedemption');
const StatusWebhookEvent = require('../models/StatusWebhookEvent');
const PaymentIntent = require('../models/PaymentIntent');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const User = require('../models/User');
const OtpSession = require('../models/OtpSession');

const CRITICAL_INDEX_MODELS = [
    ['CouponRedemption', CouponRedemption],
    ['StatusWebhookEvent', StatusWebhookEvent],
    ['PaymentIntent', PaymentIntent],
    ['Order', Order],
    ['Cart', Cart],
    ['User', User],
    ['OtpSession', OtpSession],
];

const syncCriticalIndexes = async () => {
    const synced = [];
    const failures = [];
    for (const [name, model] of CRITICAL_INDEX_MODELS) {
        try {
            await model.syncIndexes();
            synced.push(name);
        } catch (error) {
            // A failed unique-index build means duplicate data exists;
            // surfacing it lets readiness fail closed instead of silently
            // running without the integrity backstop.
            failures.push({ model: name, error: error.message });
        }
    }
    if (failures.length) {
        logger.error('index_integrity.sync_failed', { failures, synced });
    } else {
        logger.info('index_integrity.sync_complete', { synced });
    }
    return { synced, failures };
};

module.exports = { syncCriticalIndexes, CRITICAL_INDEX_MODELS };
