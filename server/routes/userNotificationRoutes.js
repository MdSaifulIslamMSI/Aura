const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { getNotifications, markAsRead, markAllAsRead } = require('../controllers/userNotificationController');

const router = express.Router();

router.use(protect); // All notification routes require authentication

router.route('/')
    .get(getNotifications);

router.route('/read')
    .put(markAsRead);

router.route('/read-all')
    .put(markAllAsRead);

module.exports = router;
