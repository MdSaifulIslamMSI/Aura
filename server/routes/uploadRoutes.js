const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { requireSecurityDecision } = require('../middleware/requireSecurityDecision');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const {
    signReviewUpload,
    uploadReviewMedia,
} = require('../controllers/uploadController');
const {
    signReviewUploadSchema,
    uploadReviewMediaSchema,
} = require('../validators/uploadValidators');

const auditReviewMediaUpload = requireSecurityDecision('upload.reviewMedia.create', {
    resourceType: 'upload',
});

router.post('/reviews/sign', protect, validate(signReviewUploadSchema), auditReviewMediaUpload, sensitiveActions.uploadWrite, signReviewUpload);
router.post('/reviews/upload', protect, validate(uploadReviewMediaSchema), auditReviewMediaUpload, sensitiveActions.uploadWrite, uploadReviewMedia);

module.exports = router;
