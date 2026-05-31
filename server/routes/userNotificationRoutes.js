const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { getNotifications, markAsRead, markAllAsRead } = require('../controllers/userNotificationController');

const router = express.Router();
const userNotificationLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'user_notifications',
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 600 : 240,
    message: 'Too many notification requests. Please slow down.',
    keyGenerator: (req) => req.authUid || req.user?.id || req.ip,
});

router.use(protect, userNotificationLimiter); // All notification routes require authentication and throttling

router.route('/')
    .get(getNotifications);

router.route('/read')
    .put(markAsRead);

router.route('/read-all')
    .put(markAllAsRead);

module.exports = router;
