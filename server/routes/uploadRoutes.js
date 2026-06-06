const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { requireTrustDecision } = require('../trust/middleware/requireTrustDecision');
const { loadUploadResource } = require('../trust/adapters/uploadAdapter');
const {
    signReviewUpload,
    uploadReviewMedia,
} = require('../controllers/uploadController');
const {
    signReviewUploadSchema,
    uploadReviewMediaSchema,
} = require('../validators/uploadValidators');

router.post('/reviews/sign', protect, validate(signReviewUploadSchema), requireTrustDecision('upload.create', loadUploadResource), sensitiveActions.uploadWrite, signReviewUpload);
router.post('/reviews/upload', protect, validate(uploadReviewMediaSchema), requireTrustDecision('upload.create', loadUploadResource), sensitiveActions.uploadWrite, uploadReviewMedia);

module.exports = router;
