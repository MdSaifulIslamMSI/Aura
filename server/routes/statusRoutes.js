const express = require('express');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const validate = require('../middleware/validate');
const { getTrustedRequestIp } = require('../utils/requestIdentity');
const {
    getPublicStatusController,
    getStatusHistoryController,
    getStatusIncidentController,
    getStatusRssController,
    subscribeStatusController,
    unsubscribeStatusController,
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

router.get('/public', getPublicStatusController);
router.get('/history', validate(statusHistorySchema), getStatusHistoryController);
router.get('/incidents/:slug', validate(statusIncidentDetailSchema), getStatusIncidentController);
router.get('/rss', getStatusRssController);
router.post('/subscribe', subscribeLimiter, validate(statusSubscribeSchema), subscribeStatusController);
router.post('/unsubscribe', validate(statusUnsubscribeSchema), unsubscribeStatusController);

module.exports = router;
