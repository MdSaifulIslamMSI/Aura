const path = require('path');
const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const User = require('../models/User');
const {
    AVATAR_UPLOAD_ALLOWED_MIME,
    AVATAR_UPLOAD_MAX_BYTES,
} = require('../utils/avatarValidation');
const { validateImageDataUriUpload } = require('../services/uploadSecurityPipeline');
const {
    createUploadToken,
    verifyAndConsumeUploadToken,
} = require('../services/uploadSignatureService');
const { normalizeAvatarImage } = require('../services/avatarImageService');
const {
    deleteAvatarMedia,
    getQuarantinedAvatarMedia,
    getStorageDriver,
    promoteAvatarMedia,
    quarantineAvatarMedia,
} = require('../services/avatarMediaStorageService');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');

const normalizeMimeType = (value) => String(value || '').trim().toLowerCase();
const normalizeFileName = (value) => {
    const raw = String(value || '').trim();
    if (!raw || raw.includes('\0') || raw.includes('/') || raw.includes('\\')) return '';
    return path.basename(raw).slice(0, 220);
};

const schedulePreviousAvatarDeletion = ({ storageKey, userId }) => {
    if (!storageKey) return;
    setImmediate(async () => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                await deleteAvatarMedia({ storageKey });
                return;
            } catch (error) {
                logger.warn('account.avatar_previous_delete_retry', {
                    userId: String(userId || ''),
                    attempt,
                    storageKey,
                    error: error?.message || 'unknown',
                });
                if (attempt < 3) {
                    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
                }
            }
        }
    });
};

const createAvatarUploadIntent = asyncHandler(async (req, res, next) => {
    const userId = String(req.user?._id || '').trim();
    if (!userId) return next(new AppError('Not authorized', 401));

    const fileName = normalizeFileName(req.body.fileName);
    const mimeType = normalizeMimeType(req.body.mimeType);
    const sizeBytes = Number(req.body.sizeBytes || 0);
    if (!fileName || fileName !== String(req.body.fileName || '').trim()) {
        return next(new AppError('Avatar file name is invalid', 400));
    }
    if (!AVATAR_UPLOAD_ALLOWED_MIME.has(mimeType)) {
        return next(new AppError('Only JPEG, PNG, and WebP avatars are allowed', 400));
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > AVATAR_UPLOAD_MAX_BYTES) {
        return next(new AppError(`Avatar must be no larger than ${AVATAR_UPLOAD_MAX_BYTES} bytes`, 400));
    }

    const { token, expiresAt } = createUploadToken({
        userId,
        purpose: 'avatar-upload',
        fileName,
        mimeType,
        maxBytes: AVATAR_UPLOAD_MAX_BYTES,
        ttlSeconds: 10 * 60,
    });

    return res.status(201).json({
        success: true,
        uploadToken: token,
        uploadUrl: '/api/account/avatar/uploads',
        expiresAt,
        constraints: {
            maxBytes: AVATAR_UPLOAD_MAX_BYTES,
            allowedMimeTypes: Array.from(AVATAR_UPLOAD_ALLOWED_MIME),
            outputMimeType: 'image/webp',
            outputDimensions: { width: 512, height: 512 },
        },
    });
});

const uploadAvatarMedia = asyncHandler(async (req, res, next) => {
    const userId = String(req.user?._id || '').trim();
    if (!userId) return next(new AppError('Not authorized', 401));

    let tokenPayload;
    try {
        tokenPayload = await verifyAndConsumeUploadToken(req.body.uploadToken);
    } catch (error) {
        return next(new AppError(error.message || 'Invalid avatar upload token', 401));
    }

    const fileName = normalizeFileName(req.body.fileName);
    const mimeType = normalizeMimeType(req.body.mimeType);
    if (
        String(tokenPayload.uid) !== userId
        || tokenPayload.purpose !== 'avatar-upload'
        || tokenPayload.fileName !== fileName
    ) {
        return next(new AppError('Avatar upload token does not match this request', 403));
    }
    if (normalizeMimeType(tokenPayload.mimeType) !== mimeType) {
        return next(new AppError('Avatar upload media type does not match the intent', 400));
    }

    const validated = await validateImageDataUriUpload({
        dataUrl: req.body.dataUrl,
        fileName,
        declaredMimeType: mimeType,
        allowedMimeTypes: AVATAR_UPLOAD_ALLOWED_MIME,
        maxBytes: Math.min(Number(tokenPayload.maxBytes || 0), AVATAR_UPLOAD_MAX_BYTES),
        purpose: 'avatar',
        userId,
        eventPrefix: 'account.avatar',
        allowMissingExtension: false,
        invalidFormatMessage: 'Invalid avatar upload payload',
        unsupportedMessage: 'Only JPEG, PNG, and WebP avatars are allowed',
        oversizedMessage: 'Avatar exceeds the upload size limit',
        emptyMessage: 'Avatar image is empty',
        mismatchMessage: 'Avatar content does not match its declared image type',
        infectedMessage: 'Avatar failed malware scan',
        scanFailedMessage: 'Avatar malware scan unavailable. Please try again later.',
    });
    const normalized = await normalizeAvatarImage(validated.fileBuffer);
    const pending = await quarantineAvatarMedia({
        fileBuffer: normalized.fileBuffer,
        ownerId: userId,
    });

    let finalizeToken;
    let expiresAt;
    try {
        const result = createUploadToken({
            userId,
            purpose: 'avatar-finalize',
            fileName: pending.storageKey,
            mimeType: normalized.mimeType,
            maxBytes: normalized.sizeBytes,
            ttlSeconds: 10 * 60,
        });
        finalizeToken = result.token;
        expiresAt = result.expiresAt;
    } catch (error) {
        await deleteAvatarMedia({ storageKey: pending.storageKey, quarantine: true }).catch(() => {});
        throw error;
    }

    return res.status(201).json({
        success: true,
        finalizeToken,
        expiresAt,
        media: {
            mimeType: normalized.mimeType,
            sizeBytes: normalized.sizeBytes,
            width: normalized.width,
            height: normalized.height,
        },
    });
});

const finalizeAvatarMedia = asyncHandler(async (req, res, next) => {
    const userId = String(req.user?._id || '').trim();
    if (!userId) return next(new AppError('Not authorized', 401));

    let tokenPayload;
    try {
        tokenPayload = await verifyAndConsumeUploadToken(req.body.finalizeToken);
    } catch (error) {
        return next(new AppError(error.message || 'Invalid avatar finalize token', 401));
    }
    if (String(tokenPayload.uid) !== userId || tokenPayload.purpose !== 'avatar-finalize') {
        return next(new AppError('Avatar finalize token does not belong to this account', 403));
    }

    const pendingBuffer = await getQuarantinedAvatarMedia({ storageKey: tokenPayload.fileName })
        .catch(() => null);
    if (!pendingBuffer || pendingBuffer.length !== Number(tokenPayload.maxBytes || 0)) {
        return next(new AppError('Avatar upload is unavailable or incomplete', 409));
    }

    const previous = await User.findById(userId)
        .select('avatar avatarMedia __v')
        .lean();
    if (!previous) return next(new AppError('User not found', 404));

    const promoted = await promoteAvatarMedia({ storageKey: tokenPayload.fileName });
    let updated;
    try {
        updated = await User.findOneAndUpdate(
            { _id: userId, __v: previous.__v },
            {
                $set: {
                    avatar: promoted.url,
                    avatarMedia: {
                        storageKey: promoted.storageKey,
                        storageDriver: promoted.storageDriver,
                        mimeType: 'image/webp',
                        sizeBytes: pendingBuffer.length,
                        width: 512,
                        height: 512,
                        updatedAt: new Date(),
                    },
                },
                $inc: { __v: 1 },
            },
            { returnDocument: 'after', projection: 'name email phone avatar gender dob bio isAdmin isVerified accountState moderation createdAt updatedAt __v', lean: true }
        );
    } catch (error) {
        await deleteAvatarMedia({ storageKey: promoted.storageKey }).catch(() => {});
        throw error;
    }

    if (!updated) {
        await deleteAvatarMedia({ storageKey: promoted.storageKey }).catch(() => {});
        return next(new AppError('Profile changed while the avatar was being saved. Please retry.', 409));
    }

    const previousStorageKey = String(previous.avatarMedia?.storageKey || '').trim();
    if (previousStorageKey && previousStorageKey !== promoted.storageKey) {
        schedulePreviousAvatarDeletion({ storageKey: previousStorageKey, userId });
    }

    recordAuthSecurityEvent({
        event: 'account.avatar.updated',
        outcome: 'success',
        reason: 'user_requested',
        surface: 'account_profile',
        req,
        meta: {
            storageDriver: getStorageDriver(),
            outputMimeType: 'image/webp',
        },
    });

    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({
        success: true,
        avatar: updated.avatar,
        profileVersion: Number(updated.__v || 0),
    });
});

module.exports = {
    createAvatarUploadIntent,
    finalizeAvatarMedia,
    uploadAvatarMedia,
    __private: {
        normalizeFileName,
        schedulePreviousAvatarDeletion,
    },
};
