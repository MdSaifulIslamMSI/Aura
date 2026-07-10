const crypto = require('crypto');
const mongoose = require('mongoose');
const xss = require('xss');
const AppError = require('../utils/AppError');
const EmergencyControl = require('../models/EmergencyControl');
const EmergencyAuditLog = require('../models/EmergencyAuditLog');
const logger = require('../utils/logger');
const {
    CRITICAL_CONFIRMATION_KEYS,
    DEFAULT_EMERGENCY_FLAGS,
    DEFAULT_EXPIRY_MINUTES,
    EMERGENCY_FLAG_KEYS,
    EMERGENCY_SEVERITIES,
    ENV_OVERRIDE_BY_KEY,
    PUBLIC_DISABLED_FEATURES,
    isValidEmergencyFlagKey,
    normalizeEmergencyFlagKey,
} = require('../config/emergencyControlConstants');
const {
    recordEmergencyAdminAction,
    setEmergencyFlagMetric,
} = require('./emergencyControlMetrics');
const { notifyEmergencyFlagChanged } = require('./emergencyNotificationService');
const browserSessionService = require('./browserSessionService');

const CACHE_TTL_MS = Math.min(
    Math.max(Number(process.env.EMERGENCY_CONTROL_CACHE_TTL_MS || 10000), 5000),
    30000
);

const SAFE_TEXT_MAX = 500;
const SAFE_REASON_MAX = 2000;
const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

let cache = {
    loadedAt: 0,
    allFlags: new Map(),
    activeFlags: new Map(),
    lastError: null,
};

class EmergencyControlError extends AppError {
    constructor({
        message,
        code = 'FEATURE_TEMPORARILY_DISABLED',
        feature = '',
        flagKey = '',
        statusCode = 503,
    } = {}) {
        super(message || 'This feature is temporarily unavailable.', statusCode);
        this.code = code;
        this.feature = feature;
        this.flagKey = flagKey;
    }
}

const parseBooleanOverride = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return undefined;
};

const sanitizeText = (value = '', maxLength = SAFE_TEXT_MAX) => xss(String(value || ''), {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style'],
}).replace(/\s+/g, ' ').trim().slice(0, maxLength);

const normalizeActorEmail = (value = '') => String(value || '').trim().toLowerCase();

const isActiveWindow = (flag = {}, now = new Date()) => {
    if (!flag?.enabled) return false;
    const startsAt = flag.startsAt ? new Date(flag.startsAt).getTime() : 0;
    const expiresAt = flag.expiresAt ? new Date(flag.expiresAt).getTime() : 0;
    const nowMs = now.getTime();
    if (Number.isFinite(startsAt) && startsAt > nowMs) return false;
    if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= nowMs) return false;
    return true;
};

const isExpired = (flag = {}, now = new Date()) => {
    const expiresAt = flag?.expiresAt ? new Date(flag.expiresAt).getTime() : 0;
    return Boolean(Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now.getTime());
};

const toPlainFlag = (flag = {}) => {
    const plain = typeof flag.toObject === 'function' ? flag.toObject() : { ...flag };
    const defaults = DEFAULT_EMERGENCY_FLAGS[plain.key] || {};
    return {
        ...defaults,
        ...plain,
        severity: plain.severity || defaults.severity || 'low',
        scope: plain.scope || defaults.scope || 'global',
        userMessage: plain.userMessage || defaults.userMessage || '',
        metadata: plain.metadata || {},
    };
};

const makeEnvFlag = (key, enabled) => {
    const defaults = DEFAULT_EMERGENCY_FLAGS[key] || {};
    return {
        _id: `env:${key}`,
        id: `env:${key}`,
        key,
        enabled: Boolean(enabled),
        severity: defaults.severity || 'critical',
        scope: defaults.scope || 'global',
        userMessage: defaults.userMessage || '',
        internalReason: 'Environment override',
        startsAt: null,
        expiresAt: null,
        metadata: { source: 'environment' },
        source: 'environment',
        createdAt: null,
        updatedAt: null,
    };
};

const getEnvOverride = (key) => {
    const envName = ENV_OVERRIDE_BY_KEY[key];
    return parseBooleanOverride(process.env[envName]);
};

const applyEnvOverride = (key, dbFlag = null) => {
    const override = getEnvOverride(key);
    if (override === undefined) return dbFlag;
    return makeEnvFlag(key, override);
};

const ensureValidKey = (key) => {
    const normalized = normalizeEmergencyFlagKey(key);
    if (!isValidEmergencyFlagKey(normalized)) {
        const error = new AppError('Invalid emergency flag key', 400);
        error.code = 'INVALID_EMERGENCY_FLAG_KEY';
        throw error;
    }
    return normalized;
};

const sortActiveFlags = (flags = []) => flags
    .map((flag) => ({
        ...flag,
        severityRank: SEVERITY_RANK[flag.severity] || 0,
    }))
    .sort((left, right) => {
        if (right.severityRank !== left.severityRank) return right.severityRank - left.severityRank;
        return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
    });

const isConfigStoreReady = () => {
    const modelConnectionState = EmergencyControl?.db?.readyState;
    return modelConnectionState === 1 || mongoose.connection.readyState === 1;
};

const refreshCache = async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && cache.loadedAt && (now - cache.loadedAt) < CACHE_TTL_MS) {
        return cache;
    }

    try {
        if (!isConfigStoreReady()) {
            const error = new Error('Emergency config store is unavailable');
            error.code = 'EMERGENCY_CONFIG_UNAVAILABLE';
            throw error;
        }

        const docs = await EmergencyControl.find({}).lean();
        const allFlags = new Map();
        const activeFlags = new Map();
        const currentDate = new Date();

        for (const doc of docs) {
            const flag = toPlainFlag(doc);
            allFlags.set(flag.key, flag);
            if (isActiveWindow(flag, currentDate)) {
                activeFlags.set(flag.key, flag);
            }
        }

        for (const key of EMERGENCY_FLAG_KEYS) {
            const defaults = DEFAULT_EMERGENCY_FLAGS[key] || {};
            if (!allFlags.has(key)) {
                allFlags.set(key, {
                    key,
                    enabled: false,
                    severity: defaults.severity || 'low',
                    scope: defaults.scope || 'global',
                    userMessage: defaults.userMessage || '',
                    internalReason: '',
                    startsAt: null,
                    expiresAt: null,
                    metadata: {},
                });
            }
        }

        cache = {
            loadedAt: now,
            allFlags,
            activeFlags,
            lastError: null,
        };

        EMERGENCY_FLAG_KEYS.forEach((key) => setEmergencyFlagMetric(key, activeFlags.has(key)));
        return cache;
    } catch (error) {
        cache.lastError = error;
        logger.error('emergency.cache_refresh_failed', {
            error: error?.message || 'unknown',
        });
        if (cache.loadedAt) return cache;
        throw error;
    }
};

const getFlag = async (key, { includeInactive = true } = {}) => {
    const normalized = ensureValidKey(key);
    const envFlag = applyEnvOverride(normalized, null);
    if (envFlag) return envFlag;
    const state = await refreshCache();
    return includeInactive
        ? state.allFlags.get(normalized) || null
        : state.activeFlags.get(normalized) || null;
};

const isEnabled = async (key, options = {}) => {
    const normalized = ensureValidKey(key);
    const override = getEnvOverride(normalized);
    if (override !== undefined) return override;

    try {
        const state = await refreshCache(options);
        return Boolean(state.activeFlags.get(normalized));
    } catch (error) {
        if (options.failClosed) {
            logger.error('emergency.flag_eval_failed_closed', {
                flagKey: normalized,
                error: error?.message || 'unknown',
            });
            return true;
        }
        logger.warn('emergency.flag_eval_failed_open', {
            flagKey: normalized,
            error: error?.message || 'unknown',
        });
        return false;
    }
};

const getAllActiveFlags = async ({ failOpen = false } = {}) => {
    try {
        const state = await refreshCache();
        const flagsByKey = new Map(state.activeFlags);
        EMERGENCY_FLAG_KEYS.forEach((key) => {
            const override = getEnvOverride(key);
            if (override === true) flagsByKey.set(key, makeEnvFlag(key, true));
            if (override === false) flagsByKey.delete(key);
        });
        return sortActiveFlags(Array.from(flagsByKey.values()));
    } catch (error) {
        if (failOpen) {
            logger.warn('emergency.active_flags_failed_open', { error: error?.message || 'unknown' });
            return [];
        }
        throw error;
    }
};

const getAllFlagsForAdmin = async () => {
    const state = await refreshCache({ force: true });
    const now = new Date();
    return EMERGENCY_FLAG_KEYS.map((key) => {
        const dbFlag = state.allFlags.get(key) || { key, ...(DEFAULT_EMERGENCY_FLAGS[key] || {}) };
        const override = getEnvOverride(key);
        const effectiveFlag = override === undefined ? dbFlag : makeEnvFlag(key, override);
        return {
            ...dbFlag,
            enabled: Boolean(effectiveFlag.enabled && isActiveWindow(effectiveFlag, now)),
            configuredEnabled: Boolean(dbFlag.enabled),
            envOverride: override === undefined ? null : override,
            expired: isExpired(dbFlag, now),
            active: Boolean(effectiveFlag.enabled && isActiveWindow(effectiveFlag, now)),
            defaultExpiryMinutes: DEFAULT_EXPIRY_MINUTES[key] || null,
            source: override === undefined ? 'database' : 'environment',
        };
    });
};

const buildPublicStatus = async () => {
    const activeFlags = await getAllActiveFlags({ failOpen: true });
    const activeByKey = new Map(activeFlags.map((flag) => [flag.key, flag]));
    const maintenance = Boolean(activeByKey.get('GLOBAL_MAINTENANCE'));
    const readOnly = Boolean(activeByKey.get('READ_ONLY_MODE'));
    const bannerFlag = activeByKey.get('SHOW_EMERGENCY_BANNER');
    const maintenanceFlag = activeByKey.get('GLOBAL_MAINTENANCE');
    const readOnlyFlag = activeByKey.get('READ_ONLY_MODE');
    const disabledFeatures = Object.entries(PUBLIC_DISABLED_FEATURES)
        .filter(([key]) => activeByKey.has(key))
        .map(([, feature]) => feature);

    return {
        maintenance,
        readOnly,
        disabledFeatures,
        bannerMessage: bannerFlag?.userMessage || maintenanceFlag?.userMessage || readOnlyFlag?.userMessage || '',
        timestamp: new Date().toISOString(),
    };
};

const toAuditSnapshot = (flag = null) => {
    if (!flag) return null;
    const plain = toPlainFlag(flag);
    return {
        key: plain.key,
        enabled: Boolean(plain.enabled),
        severity: plain.severity,
        scope: plain.scope,
        userMessage: plain.userMessage,
        startsAt: plain.startsAt || null,
        expiresAt: plain.expiresAt || null,
        requiresDualApproval: Boolean(plain.requiresDualApproval),
        metadata: plain.metadata || {},
    };
};

const getRequestAuditMeta = (req = {}) => ({
    performedByUserId: req.user?._id || null,
    performedByEmail: normalizeActorEmail(req.user?.email || req.authToken?.email || ''),
    ipAddress: String(req.ip || req.socket?.remoteAddress || ''),
    userAgent: String(req.get?.('user-agent') || req.headers?.['user-agent'] || ''),
    requestId: String(req.requestId || ''),
});

const buildAuditHash = ({
    previousHash = '',
    action = '',
    flagKey = '',
    actor = '',
    timestamp = '',
    reason = '',
} = {}) => crypto
    .createHash('sha256')
    .update([previousHash, action, flagKey, actor, timestamp, reason].join('|'))
    .digest('hex');

const createAuditLog = async ({
    action,
    flagKey,
    previousValue = null,
    newValue = null,
    reason = '',
    req = {},
    metadata = {},
} = {}) => {
    const normalized = ensureValidKey(flagKey);
    const safeReason = sanitizeText(reason, SAFE_REASON_MAX);
    const auditMeta = getRequestAuditMeta(req);
    const latest = await EmergencyAuditLog.findOne({}, 'currentHash').sort({ createdAt: -1 }).lean();
    const createdAt = new Date();
    const previousHash = latest?.currentHash || '';
    const currentHash = buildAuditHash({
        previousHash,
        action,
        flagKey: normalized,
        actor: auditMeta.performedByEmail,
        timestamp: createdAt.toISOString(),
        reason: safeReason,
    });

    return EmergencyAuditLog.create({
        action,
        flagKey: normalized,
        previousValue,
        newValue,
        ...auditMeta,
        reason: safeReason,
        metadata,
        previousHash,
        currentHash,
        createdAt,
    });
};

const resolveActivationExpiry = ({ key, expiresAt, noExpiryConfirmed = false }) => {
    if (expiresAt) {
        const date = new Date(expiresAt);
        if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
            throw new AppError('expiresAt must be a future date', 400);
        }
        return date;
    }

    const defaultMinutes = DEFAULT_EXPIRY_MINUTES[key];
    if (defaultMinutes) {
        return new Date(Date.now() + defaultMinutes * 60 * 1000);
    }

    const defaults = DEFAULT_EMERGENCY_FLAGS[key] || {};
    if ((defaults.severity === 'critical' || CRITICAL_CONFIRMATION_KEYS.has(key)) && !noExpiryConfirmed) {
        throw new AppError('Critical emergency flags require expiresAt or noExpiryConfirmed=true', 400);
    }
    return null;
};

const activateFlag = async (key, {
    reason = '',
    userMessage = '',
    severity = '',
    expiresAt = null,
    startsAt = null,
    requiresDualApproval = false,
    approvedByUserId = null,
    approvedByEmail = '',
    metadata = {},
    noExpiryConfirmed = false,
    req = {},
} = {}) => {
    const normalized = ensureValidKey(key);
    const defaults = DEFAULT_EMERGENCY_FLAGS[normalized] || {};
    const safeReason = sanitizeText(reason, SAFE_REASON_MAX);
    const safeUserMessage = sanitizeText(userMessage || defaults.userMessage || '', SAFE_TEXT_MAX);
    const resolvedSeverity = EMERGENCY_SEVERITIES.includes(severity) ? severity : defaults.severity || 'low';
    const resolvedStartsAt = startsAt ? new Date(startsAt) : null;
    const resolvedExpiresAt = resolveActivationExpiry({
        key: normalized,
        expiresAt,
        noExpiryConfirmed,
    });

    if (resolvedStartsAt && !Number.isFinite(resolvedStartsAt.getTime())) {
        throw new AppError('startsAt must be a valid date', 400);
    }

    const previous = await EmergencyControl.findOne({ key: normalized }).lean();
    const actor = getRequestAuditMeta(req);
    const update = {
        key: normalized,
        enabled: true,
        severity: resolvedSeverity,
        scope: defaults.scope || 'global',
        userMessage: safeUserMessage,
        internalReason: safeReason,
        activatedByUserId: actor.performedByUserId,
        activatedByEmail: actor.performedByEmail,
        approvedByUserId: approvedByUserId || null,
        approvedByEmail: normalizeActorEmail(approvedByEmail),
        requiresDualApproval: Boolean(requiresDualApproval),
        startsAt: resolvedStartsAt,
        expiresAt: resolvedExpiresAt,
        metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
    };

    const flag = await EmergencyControl.findOneAndUpdate(
        { key: normalized },
        { $set: update },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ).lean();

    await createAuditLog({
        action: 'ACTIVATE',
        flagKey: normalized,
        previousValue: toAuditSnapshot(previous),
        newValue: toAuditSnapshot(flag),
        reason: safeReason,
        req,
        metadata: { envOverride: getEnvOverride(normalized) !== undefined },
    });
    recordEmergencyAdminAction({ action: 'ACTIVATE', flagKey: normalized });
    await refreshCache({ force: true });

    if (normalized === 'FORCE_LOGOUT_ALL_USERS') {
        try {
            const revocation = await browserSessionService.revokeAllBrowserSessions({ revokedAfter: new Date() });
            logger.warn('emergency.force_logout_sessions_revoked', {
                flagKey: normalized,
                revoked: revocation.revoked,
                revokedAfter: revocation.revokedAfter,
                requestId: actor.requestId,
            });
        } catch (error) {
            logger.error('emergency.force_logout_revocation_failed', {
                flagKey: normalized,
                error: error?.message || 'unknown',
                requestId: actor.requestId,
            });
            const revocationError = new AppError('Global session revocation could not be confirmed.', 503);
            revocationError.code = 'GLOBAL_SESSION_REVOCATION_FAILED';
            throw revocationError;
        }
    }

    notifyEmergencyFlagChanged({
        flagKey: normalized,
        action: 'ACTIVATE',
        actor: actor.performedByEmail,
        reason: safeReason,
    }).catch((error) => {
        logger.warn('emergency.notification.non_blocking_failure', {
            flagKey: normalized,
            action: 'ACTIVATE',
            error: error?.message || 'unknown',
        });
    });

    logger.warn('emergency.flag_activated', {
        flagKey: normalized,
        severity: resolvedSeverity,
        actor: actor.performedByEmail,
        requestId: actor.requestId,
        expiresAt: resolvedExpiresAt ? resolvedExpiresAt.toISOString() : null,
    });

    return flag;
};

const deactivateFlag = async (key, {
    reason = '',
    req = {},
} = {}) => {
    const normalized = ensureValidKey(key);
    const safeReason = sanitizeText(reason, SAFE_REASON_MAX);
    const previous = await EmergencyControl.findOne({ key: normalized }).lean();
    const flag = await EmergencyControl.findOneAndUpdate(
        { key: normalized },
        {
            $set: {
                enabled: false,
                internalReason: safeReason || previous?.internalReason || '',
            },
        },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ).lean();
    const actor = getRequestAuditMeta(req);

    await createAuditLog({
        action: 'DEACTIVATE',
        flagKey: normalized,
        previousValue: toAuditSnapshot(previous),
        newValue: toAuditSnapshot(flag),
        reason: safeReason,
        req,
    });
    recordEmergencyAdminAction({ action: 'DEACTIVATE', flagKey: normalized });
    await refreshCache({ force: true });
    notifyEmergencyFlagChanged({
        flagKey: normalized,
        action: 'DEACTIVATE',
        actor: actor.performedByEmail,
        reason: safeReason,
    }).catch((error) => {
        logger.warn('emergency.notification.non_blocking_failure', {
            flagKey: normalized,
            action: 'DEACTIVATE',
            error: error?.message || 'unknown',
        });
    });

    logger.warn('emergency.flag_deactivated', {
        flagKey: normalized,
        actor: actor.performedByEmail,
        requestId: actor.requestId,
    });

    return flag;
};

const extendFlag = async (key, {
    reason = '',
    expiresAt,
    req = {},
} = {}) => {
    const normalized = ensureValidKey(key);
    const nextExpiry = resolveActivationExpiry({ key: normalized, expiresAt, noExpiryConfirmed: false });
    const safeReason = sanitizeText(reason, SAFE_REASON_MAX);
    const previous = await EmergencyControl.findOne({ key: normalized }).lean();
    const flag = await EmergencyControl.findOneAndUpdate(
        { key: normalized },
        { $set: { expiresAt: nextExpiry, internalReason: safeReason || previous?.internalReason || '' } },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ).lean();

    await createAuditLog({
        action: 'EXTEND',
        flagKey: normalized,
        previousValue: toAuditSnapshot(previous),
        newValue: toAuditSnapshot(flag),
        reason: safeReason,
        req,
    });
    recordEmergencyAdminAction({ action: 'EXTEND', flagKey: normalized });
    await refreshCache({ force: true });
    return flag;
};

const updateFlagMessage = async (key, {
    reason = '',
    userMessage = '',
    req = {},
} = {}) => {
    const normalized = ensureValidKey(key);
    const safeReason = sanitizeText(reason, SAFE_REASON_MAX);
    const safeUserMessage = sanitizeText(userMessage, SAFE_TEXT_MAX);
    const previous = await EmergencyControl.findOne({ key: normalized }).lean();
    const flag = await EmergencyControl.findOneAndUpdate(
        { key: normalized },
        { $set: { userMessage: safeUserMessage, internalReason: safeReason || previous?.internalReason || '' } },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ).lean();

    await createAuditLog({
        action: 'UPDATE_MESSAGE',
        flagKey: normalized,
        previousValue: toAuditSnapshot(previous),
        newValue: toAuditSnapshot(flag),
        reason: safeReason,
        req,
    });
    recordEmergencyAdminAction({ action: 'UPDATE_MESSAGE', flagKey: normalized });
    await refreshCache({ force: true });
    return flag;
};

const recordFailedAttempt = async ({
    flagKey = 'GLOBAL_MAINTENANCE',
    reason = '',
    req = {},
    metadata = {},
} = {}) => {
    const normalized = isValidEmergencyFlagKey(flagKey) ? normalizeEmergencyFlagKey(flagKey) : 'GLOBAL_MAINTENANCE';
    await createAuditLog({
        action: 'FAILED_ATTEMPT',
        flagKey: normalized,
        previousValue: null,
        newValue: null,
        reason,
        req,
        metadata,
    });
    recordEmergencyAdminAction({ action: 'FAILED_ATTEMPT', flagKey: normalized });
};

const buildFeatureError = (key, {
    feature = '',
    message = '',
    code = 'FEATURE_TEMPORARILY_DISABLED',
    statusCode = 503,
} = {}) => {
    const defaults = DEFAULT_EMERGENCY_FLAGS[key] || {};
    return new EmergencyControlError({
        message: message || defaults.userMessage || 'This feature is temporarily unavailable.',
        code,
        feature: feature || PUBLIC_DISABLED_FEATURES[key] || key.toLowerCase(),
        flagKey: key,
        statusCode,
    });
};

const requireAllowed = async (key, options = {}) => {
    const normalized = ensureValidKey(key);
    if (await isEnabled(normalized, { failClosed: Boolean(options.failClosed) })) {
        throw buildFeatureError(normalized, options);
    }
};

const requireWritable = async () => {
    if (await isEnabled('READ_ONLY_MODE', { failClosed: true })) {
        throw buildFeatureError('READ_ONLY_MODE', {
            code: 'READ_ONLY_MODE',
            feature: 'write',
            statusCode: 423,
        });
    }
};

const requirePaymentAllowed = async () => requireAllowed('DISABLE_PAYMENT', {
    failClosed: true,
    feature: 'payment',
    message: 'Payments are temporarily unavailable. Please try again later.',
});

const requireCheckoutAllowed = async () => requireAllowed('DISABLE_CHECKOUT', {
    failClosed: true,
    feature: 'checkout',
});

const requireAuthAllowed = async () => requireAllowed('DISABLE_LOGIN', {
    failClosed: false,
    feature: 'auth',
});

const requireOtpAllowed = async () => requireAllowed('DISABLE_OTP_SEND', {
    failClosed: true,
    feature: 'otp',
    message: 'Verification is temporarily unavailable. Please try again later.',
});

const requireAdminMutationAllowed = async () => requireAllowed('DISABLE_ADMIN_MUTATIONS', {
    failClosed: true,
    feature: 'admin',
});

const clearEmergencyCache = () => {
    cache = {
        loadedAt: 0,
        allFlags: new Map(),
        activeFlags: new Map(),
        lastError: null,
    };
};

module.exports = {
    EmergencyControlError,
    activateFlag,
    buildFeatureError,
    buildPublicStatus,
    clearEmergencyCache,
    createAuditLog,
    deactivateFlag,
    extendFlag,
    getAllActiveFlags,
    getAllFlagsForAdmin,
    getFlag,
    isConfigStoreReady,
    isEnabled,
    isExpired,
    recordFailedAttempt,
    refreshCache,
    requireAdminMutationAllowed,
    requireAllowed,
    requireAuthAllowed,
    requireCheckoutAllowed,
    requireOtpAllowed,
    requirePaymentAllowed,
    requireWritable,
    sanitizeText,
    updateFlagMessage,
};
