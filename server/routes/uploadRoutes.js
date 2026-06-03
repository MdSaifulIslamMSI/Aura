const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const {
    signReviewUpload,
    uploadReviewMedia,
} = require('../controllers/uploadController');
const {
    signReviewUploadSchema,
    uploadReviewMediaSchema,
} = require('../validators/uploadValidators');

router.post('/reviews/sign', protect, validate(signReviewUploadSchema), sensitiveActions.uploadWrite, signReviewUpload);
router.post('/reviews/upload', protect, validate(uploadReviewMediaSchema), sensitiveActions.uploadWrite, uploadReviewMedia);

module.exports = router;
