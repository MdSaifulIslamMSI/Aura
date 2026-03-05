const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    listAdminNotifications,
    getAdminNotificationSummary,
    markAdminNotificationRead,
    markAllAdminNotificationsRead,
} = require('../controllers/adminNotificationController');
const {
    adminNotificationListSchema,
    adminNotificationMarkReadSchema,
    adminNotificationMarkAllReadSchema,
} = require('../validators/adminNotificationValidators');

router.get('/summary', protect, admin, getAdminNotificationSummary);
router.get('/', protect, admin, validate(adminNotificationListSchema), listAdminNotifications);
router.patch('/read-all', protect, admin, validate(adminNotificationMarkAllReadSchema), markAllAdminNotificationsRead);
router.patch('/:notificationId/read', protect, admin, validate(adminNotificationMarkReadSchema), markAdminNotificationRead);

module.exports = router;
