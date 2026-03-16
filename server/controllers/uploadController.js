const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
    createUploadToken,
    verifyAndConsumeUploadToken,
} = require('../services/uploadSignatureService');
const {
    ensureReviewUploadStorageReady,
    getStorageDriver,
    storeReviewMedia,
} = require('../services/reviewMediaStorageService');
const REVIEW_UPLOAD_MAX_BYTES = Number(process.env.REVIEW_UPLOAD_MAX_BYTES || 7 * 1024 * 1024);
const REVIEW_UPLOAD_ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
]);

const normalizeMimeType = (value) => String(value || '').trim().toLowerCase();
const normalizeFileName = (value) => String(value || '').replace(/[^\w.\-() ]+/g, '').trim().slice(0, 220);

const getDataUrlParts = (dataUrl = '') => {
    const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) return null;
    return {
        mimeType: normalizeMimeType(match[1]),
        base64: match[2],
    };
};

// @desc    Sign review media upload request
// @route   POST /api/uploads/reviews/sign
// @access  Private
const signReviewUpload = asyncHandler(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
        return next(new AppError('Not authorized', 401));
    }

    const fileName = normalizeFileName(req.body.fileName || 'review-media');
    const mimeType = normalizeMimeType(req.body.mimeType);
    const sizeBytes = Number(req.body.sizeBytes || 0);

    if (!fileName) {
        return next(new AppError('fileName is required', 400));
    }
    if (!REVIEW_UPLOAD_ALLOWED_MIME.has(mimeType)) {
        return next(new AppError('Unsupported file type for review upload', 400));
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return next(new AppError('sizeBytes must be a positive number', 400));
    }
    if (sizeBytes > REVIEW_UPLOAD_MAX_BYTES) {
        return next(new AppError(`File too large. Max upload size is ${Math.floor(REVIEW_UPLOAD_MAX_BYTES / (1024 * 1024))}MB`, 400));
    }

    const { token, expiresAt } = createUploadToken({
        userId: String(userId),
        purpose: 'review-media',
        fileName,
        mimeType,
        maxBytes: REVIEW_UPLOAD_MAX_BYTES,
        ttlSeconds: 10 * 60,
    });

    res.json({
        success: true,
        uploadToken: token,
        uploadUrl: '/api/uploads/reviews/upload',
        expiresAt,
        constraints: {
            maxBytes: REVIEW_UPLOAD_MAX_BYTES,
            allowedMimeTypes: Array.from(REVIEW_UPLOAD_ALLOWED_MIME),
        },
    });
});

// @desc    Upload review media using signed one-time token
// @route   POST /api/uploads/reviews/upload
// @access  Private
const uploadReviewMedia = asyncHandler(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
        return next(new AppError('Not authorized', 401));
    }

    const uploadToken = String(req.body.uploadToken || '').trim();
    const fileName = normalizeFileName(req.body.fileName || 'review-media');
    const mimeType = normalizeMimeType(req.body.mimeType);
    const dataUrl = String(req.body.dataUrl || '');

    if (!uploadToken || !mimeType || !dataUrl) {
        return next(new AppError('uploadToken, mimeType and dataUrl are required', 400));
    }

    let tokenPayload;
    try {
        tokenPayload = await verifyAndConsumeUploadToken(uploadToken);
    } catch (error) {
        return next(new AppError(error.message || 'Invalid upload token', 401));
    }

    if (String(tokenPayload.uid) !== String(userId)) {
        return next(new AppError('Upload token user mismatch', 403));
    }
    if (tokenPayload.purpose !== 'review-media') {
        return next(new AppError('Upload token purpose mismatch', 403));
    }
    if (normalizeMimeType(tokenPayload.mimeType) !== mimeType) {
        return next(new AppError('Upload token mime type mismatch', 400));
    }
    if (!REVIEW_UPLOAD_ALLOWED_MIME.has(mimeType)) {
        return next(new AppError('Unsupported upload mime type', 400));
    }

    const parsedData = getDataUrlParts(dataUrl);
    if (!parsedData || parsedData.mimeType !== mimeType) {
        return next(new AppError('dataUrl mime type mismatch', 400));
    }

    let fileBuffer;
    try {
        fileBuffer = Buffer.from(parsedData.base64, 'base64');
    } catch {
        return next(new AppError('Invalid base64 data payload', 400));
    }

    if (!fileBuffer || fileBuffer.length <= 0) {
        return next(new AppError('Uploaded file is empty', 400));
    }
    if (fileBuffer.length > REVIEW_UPLOAD_MAX_BYTES || fileBuffer.length > Number(tokenPayload.maxBytes || 0)) {
        return next(new AppError('Uploaded file exceeds max size', 400));
    }

    await ensureReviewUploadStorageReady();
    const storedMedia = await storeReviewMedia({
        fileBuffer,
        fileName,
        mimeType,
    });

    const mediaType = mimeType.startsWith('video/') ? 'video' : 'image';

    logger.info('reviews.media_uploaded', {
        userId: String(userId),
        bytes: fileBuffer.length,
        mimeType,
        storageDriver: getStorageDriver(),
        storageKey: storedMedia.storageKey,
        url: storedMedia.url,
    });

    res.status(201).json({
        success: true,
        media: {
            type: mediaType,
            url: storedMedia.url,
            mimeType,
            sizeBytes: fileBuffer.length,
        },
    });
});

module.exports = {
    signReviewUpload,
    uploadReviewMedia,
};
