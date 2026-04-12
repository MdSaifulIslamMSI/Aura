const express = require('express');
const validate = require('../middleware/validate');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { requireInternalAiAuth } = require('../middleware/internalAiAuth');
const { requireInternalJobAuth } = require('../middleware/internalJobAuth');
const {
    handleAiChat,
    handleAiChatStream,
} = require('../controllers/aiController');
const {
    runPaymentOutboxMaintenance,
    runOrderEmailMaintenance,
    runCatalogImportMaintenance,
    runCatalogSyncMaintenance,
    runAdminAnalyticsMaintenance,
    runDailyMaintenance,
    runFxRateRefresh,
} = require('../controllers/internalOpsController');
const {
    aiChatSchema,
} = require('../validators/aiValidators');

const router = express.Router();

const internalAiChatLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'internal_ai_chat',
    windowMs: 60 * 1000,
    max: 120,
    keyGenerator: (req) => req.internalAi?.source || req.ip,
    message: 'Too many internal AI requests. Please slow down.',
});

router.get('/cron/payment-outbox', requireInternalJobAuth, runPaymentOutboxMaintenance);
router.get('/cron/order-email', requireInternalJobAuth, runOrderEmailMaintenance);
router.get('/cron/catalog-import', requireInternalJobAuth, runCatalogImportMaintenance);
router.get('/cron/catalog-sync', requireInternalJobAuth, runCatalogSyncMaintenance);
router.get('/cron/admin-analytics', requireInternalJobAuth, runAdminAnalyticsMaintenance);
router.get('/cron/daily-maintenance', requireInternalJobAuth, runDailyMaintenance);
router.get('/cron/fx-rates', requireInternalJobAuth, runFxRateRefresh);
router.post('/ai/chat', requireInternalAiAuth, internalAiChatLimiter, validate(aiChatSchema), handleAiChat);
router.post('/ai/chat/stream', requireInternalAiAuth, internalAiChatLimiter, validate(aiChatSchema), handleAiChatStream);

module.exports = router;
