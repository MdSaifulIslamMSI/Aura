const crypto = require('crypto');
const AuthSecurityEventOutbox = require('../models/AuthSecurityEventOutbox');
const AppError = require('../utils/AppError');

const ACTIVITY_RETENTION_DAYS = 180;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const CURSOR_CONTEXT = 'aura-account-security-activity-v1';

const SAFE_EVENT_TYPES = Object.freeze({
    login_session: 'sign_in',
    enterprise_oidc_login: 'sign_in',
    duo_oidc_login: 'sign_in',
    login_risk: 'suspicious_sign_in',
    password_reset: 'password_changed',
    'mfa.passkey.registered': 'passkey_added',
    'mfa.passkey.removed': 'passkey_removed',
    'mfa.totp.enabled': 'authenticator_enabled',
    'mfa.totp.disabled': 'authenticator_disabled',
    'mfa.recovery.generated': 'recovery_codes_changed',
    'mfa.recovery.used': 'recovery_code_used',
    'auth.session.revoked_by_user': 'session_revoked',
    'auth.sessions.other_revoked_by_user': 'sessions_revoked',
    'auth.sessions.all_revoked_by_user': 'global_logout',
    'auth.session.new_device': 'new_device_sign_in',
    'trusted_device.revoked': 'remembered_browser_revoked',
    'trusted_device.others_revoked': 'remembered_browsers_revoked',
});

const parseLimit = (value) => {
    if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        throw new AppError(`Security activity limit must be between 1 and ${MAX_LIMIT}`, 400);
    }
    return parsed;
};

const getCursorSecret = () => {
    const secret = String(
        process.env.ACCOUNT_CURSOR_SIGNING_SECRET
        || process.env.SESSION_SECRET
        || process.env.JWT_SECRET
        || ''
    ).trim();
    if (!secret) throw new AppError('Security activity is temporarily unavailable', 503);
    return secret;
};

const signCursorPayload = (payload, userId) => crypto
    .createHmac('sha256', getCursorSecret())
    .update(`${CURSOR_CONTEXT}:${String(userId)}:${payload}`)
    .digest('base64url');

const encodeCursor = ({ createdAt, id, userId }) => {
    const timestamp = new Date(createdAt).getTime();
    const objectId = String(id || '').trim();
    if (!Number.isFinite(timestamp) || !/^[a-f0-9]{24}$/i.test(objectId)) {
        throw new AppError('Security activity cursor could not be created', 500);
    }
    const payload = Buffer.from(JSON.stringify([timestamp, objectId]), 'utf8').toString('base64url');
    return `${payload}.${signCursorPayload(payload, userId)}`;
};

const decodeCursor = (value, userId) => {
    if (!value) return null;
    try {
        const [payload, signature, extra] = String(value).split('.');
        if (!payload || !signature || extra) throw new Error('invalid cursor');
        const expected = Buffer.from(signCursorPayload(payload, userId));
        const received = Buffer.from(signature);
        if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
            throw new Error('invalid cursor signature');
        }
        const [timestamp, id] = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const date = new Date(timestamp);
        if (!Number.isFinite(date.getTime()) || !/^[a-f0-9]{24}$/i.test(String(id || ''))) {
            throw new Error('invalid cursor payload');
        }
        return { createdAt: date, id: String(id) };
    } catch {
        throw new AppError('Invalid security activity cursor', 400);
    }
};

const normalizeOutcome = (value) => {
    const outcome = String(value || '').trim().toLowerCase();
    if (['success', 'issued'].includes(outcome)) return 'success';
    if (['blocked', 'denied', 'challenge'].includes(outcome)) return 'attention';
    return 'failure';
};

const listAccountSecurityActivity = async ({ userId, limit, cursor } = {}) => {
    const ownerKey = String(userId || '').trim();
    if (!ownerKey) throw new AppError('Not authorized', 401);

    const pageLimit = parseLimit(limit);
    const before = decodeCursor(cursor, ownerKey);
    const filter = {
        'payload.userId': ownerKey,
        'payload.event': { $in: Object.keys(SAFE_EVENT_TYPES) },
    };
    if (before) {
        filter.$or = [
            { createdAt: { $lt: before.createdAt } },
            { createdAt: before.createdAt, _id: { $lt: before.id } },
        ];
    }

    const records = await AuthSecurityEventOutbox.find(filter)
        .select('payload.event payload.outcome payload.occurredAt createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .limit(pageLimit + 1)
        .lean();
    const hasMore = records.length > pageLimit;
    const page = hasMore ? records.slice(0, pageLimit) : records;

    return {
        version: 1,
        retentionDays: ACTIVITY_RETENTION_DAYS,
        activity: page.map((record) => ({
            type: SAFE_EVENT_TYPES[record.payload?.event],
            outcome: normalizeOutcome(record.payload?.outcome),
            occurredAt: record.payload?.occurredAt || record.createdAt,
        })),
        pagination: {
            limit: pageLimit,
            hasMore,
            nextCursor: hasMore && page.length
                ? encodeCursor({
                    createdAt: page[page.length - 1].createdAt,
                    id: page[page.length - 1]._id,
                    userId: ownerKey,
                })
                : null,
        },
    };
};

module.exports = {
    ACTIVITY_RETENTION_DAYS,
    listAccountSecurityActivity,
    __private: {
        SAFE_EVENT_TYPES,
        decodeCursor,
        encodeCursor,
        normalizeOutcome,
    },
};
