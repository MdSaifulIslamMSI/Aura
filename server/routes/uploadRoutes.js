const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    signReviewUpload,
    uploadReviewMedia,
} = require('../controllers/uploadController');
const {
    signReviewUploadSchema,
    uploadReviewMediaSchema,
} = require('../validators/uploadValidators');

router.post('/reviews/sign', protect, validate(signReviewUploadSchema), signReviewUpload);
router.post('/reviews/upload', protect, validate(uploadReviewMediaSchema), uploadReviewMedia);

module.exports = router;
