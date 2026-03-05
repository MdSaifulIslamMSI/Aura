const IdempotencyRecord = require('../../models/IdempotencyRecord');
const AppError = require('../../utils/AppError');
const { hashPayload } = require('./helpers');

const getRequiredIdempotencyKey = (req) => {
    const key = String(req.headers['idempotency-key'] || '').trim();
    if (!key) {
        throw new AppError('Idempotency-Key header is required', 400);
    }
    if (key.length < 8 || key.length > 128) {
        throw new AppError('Idempotency-Key must be between 8 and 128 characters', 400);
    }
    return key;
};

const getStableUserKey = (req) => {
    if (req.user?._id) return String(req.user._id);
    if (req.user?.email) return req.user.email;
    return 'anonymous';
};

const withIdempotency = async ({
    key,
    userKey,
    route,
    requestPayload,
    handler,
}) => {
    const requestHash = hashPayload(requestPayload || {});

    const existing = await IdempotencyRecord.findOne({ key, user: userKey, route }).lean();
    if (existing) {
        if (existing.requestHash !== requestHash) {
            throw new AppError('Idempotency-Key reuse with different payload is not allowed', 409);
        }
        return {
            replayed: true,
            statusCode: existing.statusCode,
            response: existing.response,
        };
    }

    try {
        const { statusCode, response } = await handler();
        await IdempotencyRecord.create({
            key,
            user: userKey,
            route,
            requestHash,
            statusCode,
            response,
            processedAt: new Date(),
            expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)),
        });
        return { replayed: false, statusCode, response };
    } catch (error) {
        if (error?.code === 11000) {
            const retry = await IdempotencyRecord.findOne({ key, user: userKey, route }).lean();
            if (retry && retry.requestHash === requestHash) {
                return {
                    replayed: true,
                    statusCode: retry.statusCode,
                    response: retry.response,
                };
            }
        }
        throw error;
    }
};

module.exports = {
    getRequiredIdempotencyKey,
    getStableUserKey,
    withIdempotency,
};

