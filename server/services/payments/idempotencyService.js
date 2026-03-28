const crypto = require('crypto');
const IdempotencyRecord = require('../../models/IdempotencyRecord');
const AppError = require('../../utils/AppError');
const { hashPayload } = require('./helpers');

const parseBoundedInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
};

const IDEMPOTENCY_RECORD_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_PROCESSING_TTL_MS = parseBoundedInt(
    process.env.IDEMPOTENCY_PROCESSING_TTL_MS,
    5 * 60 * 1000,
    { min: 1000, max: 60 * 60 * 1000 }
);
const IDEMPOTENCY_WAIT_TIMEOUT_MS = parseBoundedInt(
    process.env.IDEMPOTENCY_WAIT_TIMEOUT_MS,
    15 * 1000,
    { min: 100, max: 60 * 1000 }
);
const IDEMPOTENCY_WAIT_POLL_MS = parseBoundedInt(
    process.env.IDEMPOTENCY_WAIT_POLL_MS,
    150,
    { min: 25, max: 5000 }
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const makeReservationId = ({ key, userKey, route }) => (
    hashPayload(`${String(userKey)}:${String(route)}:${String(key)}`).slice(0, 24)
);

const buildProcessingRecordPayload = ({
    key,
    userKey,
    route,
    requestHash,
    lockToken,
}) => ({
    _id: makeReservationId({ key, userKey, route }),
    key,
    user: userKey,
    route,
    requestHash,
    state: 'processing',
    lockToken,
    lockExpiresAt: new Date(Date.now() + IDEMPOTENCY_PROCESSING_TTL_MS),
    statusCode: 202,
    response: {},
    processedAt: new Date(),
    expiresAt: new Date(Date.now() + IDEMPOTENCY_RECORD_TTL_MS),
});

const assertMatchingRequestHash = (record, requestHash) => {
    if (record?.requestHash && record.requestHash !== requestHash) {
        throw new AppError('Idempotency-Key reuse with different payload is not allowed', 409);
    }
};

const isProcessingRecordExpired = (record) => {
    const expiresAt = record?.lockExpiresAt ? new Date(record.lockExpiresAt) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) return true;
    return expiresAt.getTime() <= Date.now();
};

const waitForSettledRecord = async ({
    key,
    userKey,
    route,
    requestHash,
}) => {
    const deadline = Date.now() + IDEMPOTENCY_WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
        await sleep(IDEMPOTENCY_WAIT_POLL_MS);

        const current = await IdempotencyRecord.findOne({ key, user: userKey, route }).lean();
        if (!current) return null;
        assertMatchingRequestHash(current, requestHash);

        if (current.state === 'completed') {
            return current;
        }

        if (isProcessingRecordExpired(current)) {
            return current;
        }
    }

    return IdempotencyRecord.findOne({ key, user: userKey, route }).lean();
};

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
    const lockToken = crypto.randomUUID();
    let reservedRecord = null;

    while (!reservedRecord) {
        try {
            reservedRecord = await IdempotencyRecord.create(buildProcessingRecordPayload({
                key,
                userKey,
                route,
                requestHash,
                lockToken,
            }));
        } catch (error) {
            if (error?.code !== 11000) {
                throw error;
            }

            const existing = await IdempotencyRecord.findOne({ key, user: userKey, route }).lean();
            if (!existing) {
                continue;
            }

            assertMatchingRequestHash(existing, requestHash);

            if (existing.state === 'completed') {
                return {
                    replayed: true,
                    statusCode: existing.statusCode,
                    response: existing.response,
                };
            }

            if (!isProcessingRecordExpired(existing)) {
                const settled = await waitForSettledRecord({
                    key,
                    userKey,
                    route,
                    requestHash,
                });

                if (!settled) {
                    continue;
                }

                assertMatchingRequestHash(settled, requestHash);

                if (settled.state === 'completed') {
                    return {
                        replayed: true,
                        statusCode: settled.statusCode,
                        response: settled.response,
                    };
                }
            }

            const reclaimed = await IdempotencyRecord.findOneAndUpdate(
                {
                    _id: existing._id,
                    key,
                    user: userKey,
                    route,
                    requestHash,
                    state: 'processing',
                    $or: [
                        { lockExpiresAt: { $lte: new Date() } },
                        { lockExpiresAt: null },
                        { lockExpiresAt: { $exists: false } },
                    ],
                },
                {
                    $set: {
                        lockToken,
                        lockExpiresAt: new Date(Date.now() + IDEMPOTENCY_PROCESSING_TTL_MS),
                        processedAt: new Date(),
                        expiresAt: new Date(Date.now() + IDEMPOTENCY_RECORD_TTL_MS),
                    },
                },
                { returnDocument: 'after' }
            );

            if (reclaimed) {
                reservedRecord = reclaimed;
                break;
            }

            const settled = await waitForSettledRecord({
                key,
                userKey,
                route,
                requestHash,
            });
            if (!settled) {
                continue;
            }

            assertMatchingRequestHash(settled, requestHash);

            if (settled.state === 'completed') {
                return {
                    replayed: true,
                    statusCode: settled.statusCode,
                    response: settled.response,
                };
            }

            throw new AppError('A matching request with this Idempotency-Key is still processing. Retry shortly.', 409);
        }
    }

    try {
        const { statusCode, response } = await handler();
        await IdempotencyRecord.updateOne(
            {
                _id: reservedRecord._id,
                key,
                user: userKey,
                route,
                state: 'processing',
                lockToken,
            },
            {
                $set: {
                    state: 'completed',
                    lockToken: '',
                    lockExpiresAt: null,
                    statusCode,
                    response,
                    processedAt: new Date(),
                    expiresAt: new Date(Date.now() + IDEMPOTENCY_RECORD_TTL_MS),
                },
            }
        );
        return { replayed: false, statusCode, response };
    } catch (error) {
        await IdempotencyRecord.deleteOne({
            _id: reservedRecord._id,
            key,
            user: userKey,
            route,
            state: 'processing',
            lockToken,
        }).catch(() => null);
        throw error;
    }
};

module.exports = {
    getRequiredIdempotencyKey,
    getStableUserKey,
    withIdempotency,
};
