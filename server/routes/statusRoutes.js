const express = require('express');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const validate = require('../middleware/validate');
const { getTrustedRequestIp } = require('../utils/requestIdentity');
const {
    getActiveStatusIncidentsController,
    getPublicStatusController,
    getStatusComponentsController,
    getStatusHistoryController,
    getStatusIncidentController,
    getStatusMaintenanceController,
    getStatusRssController,
    getStatusSummaryController,
    createStatusWebhookController,
    subscribeStatusController,
    unsubscribeStatusController,
    verifyStatusSubscriptionController,
} = require('../controllers/statusController');
const {
    statusHistorySchema,
    statusIncidentDetailSchema,
    statusSubscribeSchema,
    statusUnsubscribeSchema,
} = require('../validators/statusValidators');

const router = express.Router();

const subscribeLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'status_subscribe',
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 40 : 8,
    message: { status: 'error', message: 'Too many subscription attempts, please try again later.' },
    keyGenerator: (req) => getTrustedRequestIp(req),
});

const webhookLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'status_webhook',
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 240 : 60,
    message: { status: 'error', message: 'Too many status webhook events, please slow down.' },
    keyGenerator: (req) => getTrustedRequestIp(req),
});

router.get('/public', getPublicStatusController);
router.get('/components', getStatusComponentsController);
router.get('/incidents/active', getActiveStatusIncidentsController);
router.get('/incidents/history', validate(statusHistorySchema), getStatusHistoryController);
router.get('/history', validate(statusHistorySchema), getStatusHistoryController);
router.get('/maintenance', getStatusMaintenanceController);
router.get('/summary.json', getStatusSummaryController);
router.get('/incidents/:slug', validate(statusIncidentDetailSchema), getStatusIncidentController);
router.get('/rss', getStatusRssController);
router.get('/rss.xml', getStatusRssController);
router.post('/webhooks/uptime-kuma', webhookLimiter, createStatusWebhookController('uptime_kuma'));
router.post('/webhooks/gatus', webhookLimiter, createStatusWebhookController('gatus'));
router.post('/webhooks/alertmanager', webhookLimiter, createStatusWebhookController('alertmanager'));
router.post('/webhooks/github-actions', webhookLimiter, createStatusWebhookController('github_actions'));
router.post('/subscribe', subscribeLimiter, validate(statusSubscribeSchema), subscribeStatusController);
router.get('/subscribe/verify', verifyStatusSubscriptionController);
router.post('/unsubscribe', validate(statusUnsubscribeSchema), unsubscribeStatusController);

module.exports = router;
