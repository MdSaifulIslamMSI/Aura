const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    listAdminOrderEmails,
    getAdminOrderEmailById,
    retryAdminOrderEmail,
} = require('../controllers/orderEmailAdminController');
const {
    adminOrderEmailListSchema,
    adminOrderEmailDetailSchema,
    adminOrderEmailRetrySchema,
} = require('../validators/orderEmailValidators');

router.get('/', protect, admin, validate(adminOrderEmailListSchema), listAdminOrderEmails);
router.get('/:notificationId', protect, admin, validate(adminOrderEmailDetailSchema), getAdminOrderEmailById);
router.post('/:notificationId/retry', protect, admin, validate(adminOrderEmailRetrySchema), retryAdminOrderEmail);

module.exports = router;
