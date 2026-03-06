const express = require('express');
const { requireInternalJobAuth } = require('../middleware/internalJobAuth');
const {
    runPaymentOutboxMaintenance,
    runOrderEmailMaintenance,
    runCatalogImportMaintenance,
    runCatalogSyncMaintenance,
    runAdminAnalyticsMaintenance,
    runDailyMaintenance,
} = require('../controllers/internalOpsController');

const router = express.Router();

router.use(requireInternalJobAuth);

router.get('/cron/payment-outbox', runPaymentOutboxMaintenance);
router.get('/cron/order-email', runOrderEmailMaintenance);
router.get('/cron/catalog-import', runCatalogImportMaintenance);
router.get('/cron/catalog-sync', runCatalogSyncMaintenance);
router.get('/cron/admin-analytics', runAdminAnalyticsMaintenance);
router.get('/cron/daily-maintenance', runDailyMaintenance);

module.exports = router;
