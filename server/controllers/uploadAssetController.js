const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const {
    getStorageDriver,
    getReviewMediaObject,
} = require('../services/reviewMediaStorageService');

const isMissingObjectError = (error) => {
    const status = Number(error?.$metadata?.httpStatusCode || 0);
    return status === 404 || error?.name === 'NoSuchKey' || error?.Code === 'NoSuchKey';
};

const isSafeReviewAssetPath = (value) => (
    /^[A-Za-z0-9._\-()/]+$/.test(value)
    && !value.includes('..')
    && !value.startsWith('/')
);

const pipeBodyToResponse = async (body, res) => {
    if (!body) {
        throw new Error('Missing upload body');
    }

    if (typeof body.pipe === 'function') {
        await new Promise((resolve, reject) => {
            body.on('error', reject);
            res.on('close', resolve);
            body.pipe(res);
        });
        return;
    }

    if (typeof body.transformToByteArray === 'function') {
        const bytes = await body.transformToByteArray();
        res.end(Buffer.from(bytes));
        return;
    }

    if (Buffer.isBuffer(body)) {
        res.end(body);
        return;
    }

    throw new Error('Unsupported upload body type');
};

const serveReviewMediaAsset = asyncHandler(async (req, res, next) => {
    if (getStorageDriver() !== 's3') {
        return next();
    }

    const reviewAssetPath = String(req.params[0] || '').trim();
    if (!reviewAssetPath || !isSafeReviewAssetPath(reviewAssetPath)) {
        return next(new AppError('Upload not found', 404));
    }

    const storageKey = `reviews/${reviewAssetPath}`.replace(/\/+/g, '/');

    let object;
    try {
        object = await getReviewMediaObject({ storageKey });
    } catch (error) {
        if (isMissingObjectError(error)) {
            return next(new AppError('Upload not found', 404));
        }
        throw error;
    }

    if (object.contentType) {
        res.setHeader('Content-Type', object.contentType);
    }
    if (object.cacheControl) {
        res.setHeader('Cache-Control', object.cacheControl);
    } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    if (object.contentLength > 0) {
        res.setHeader('Content-Length', String(object.contentLength));
    }
    if (object.etag) {
        res.setHeader('ETag', object.etag);
    }
    if (object.lastModified) {
        res.setHeader('Last-Modified', new Date(object.lastModified).toUTCString());
    }

    await pipeBodyToResponse(object.body, res);
});

module.exports = {
    serveReviewMediaAsset,
};
