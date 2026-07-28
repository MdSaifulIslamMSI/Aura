const asyncHandler = require('express-async-handler');
const AccountPreference = require('../models/AccountPreference');
const AppError = require('../utils/AppError');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');

const SCHEMA_VERSION = 1;
const MANDATORY_SECURITY_CHANNELS = ['email', 'sms', 'push'];

const buildDefaultPreferences = () => ({
    schemaVersion: SCHEMA_VERSION,
    version: 0,
    notifications: {
        orderUpdates: { email: true, sms: false, push: true },
        deliveryUpdates: { email: true, sms: false, push: true },
        returnRefundUpdates: { email: true, sms: false, push: true },
        marketplaceUpdates: { email: true, sms: false, push: true },
        productAlerts: { email: false, sms: false, push: true },
        marketing: { email: false, sms: false, push: false },
        security: { email: true, sms: true, push: true, mandatory: true },
    },
    localization: {
        language: 'en',
        locale: 'en-IN',
        currency: 'INR',
    },
    accessibility: {
        reducedMotion: false,
        highContrast: false,
    },
    updatedAt: null,
});

const toPreferencePayload = (record = null) => {
    if (!record) return buildDefaultPreferences();
    const value = typeof record.toObject === 'function' ? record.toObject() : record;
    return {
        schemaVersion: Number(value.schemaVersion || SCHEMA_VERSION),
        version: Number(value.revision || 0),
        notifications: {
            ...buildDefaultPreferences().notifications,
            ...(value.notifications || {}),
            security: {
                ...buildDefaultPreferences().notifications.security,
                ...(value.notifications?.security || {}),
                mandatory: true,
            },
        },
        localization: {
            ...buildDefaultPreferences().localization,
            ...(value.localization || {}),
        },
        accessibility: {
            ...buildDefaultPreferences().accessibility,
            ...(value.accessibility || {}),
        },
        updatedAt: value.updatedAt || null,
    };
};

const getOwnerKey = (req) => String(req.authUid || req.user?._id || '').trim();

const assertMandatorySecurityPreferences = (notifications = {}) => {
    const security = notifications?.security || {};
    const disabledChannel = MANDATORY_SECURITY_CHANNELS.find((channel) => security[channel] === false);
    if (!disabledChannel) return;

    const error = new AppError('Required security notifications cannot be disabled', 400);
    error.code = 'ACCOUNT_REQUIRED_NOTIFICATION';
    throw error;
};

const flattenUpdates = (payload = {}) => {
    const updates = {};
    ['notifications', 'localization', 'accessibility'].forEach((group) => {
        Object.entries(payload[group] || {}).forEach(([key, value]) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                Object.entries(value).forEach(([nestedKey, nestedValue]) => {
                    updates[`${group}.${key}.${nestedKey}`] = nestedValue;
                });
                return;
            }
            updates[`${group}.${key}`] = value;
        });
    });
    return updates;
};

const buildConsentAudit = (current = {}, notifications = {}) => {
    const now = new Date();
    const entries = [];
    Object.entries(notifications || {}).forEach(([preference, channels]) => {
        Object.entries(channels || {}).forEach(([channel, enabled]) => {
            if (current?.[preference]?.[channel] === enabled) return;
            entries.push({ preference, channel, enabled, changedAt: now });
        });
    });
    return entries;
};

const getAccountPreferences = asyncHandler(async (req, res, next) => {
    const ownerKey = getOwnerKey(req);
    if (!ownerKey) return next(new AppError('Not authorized', 401));

    const record = await AccountPreference.findOne({ ownerKey: getOwnerKey(req) }).lean();
    res.set('Cache-Control', 'private, no-store');
    res.json({
        success: true,
        preferences: toPreferencePayload(record),
    });
});

const updateAccountPreferences = asyncHandler(async (req, res, next) => {
    const ownerKey = getOwnerKey(req);
    if (!ownerKey) return next(new AppError('Not authorized', 401));

    assertMandatorySecurityPreferences(req.body.notifications);
    const expectedVersion = req.body.version;
    const current = await AccountPreference.findOne({ ownerKey }).lean();
    const currentVersion = Number(current?.revision || 0);
    if (currentVersion !== expectedVersion) {
        const conflict = new AppError('Preferences changed in another session. Refresh and try again.', 409);
        conflict.code = 'ACCOUNT_PREFERENCES_VERSION_CONFLICT';
        conflict.current = toPreferencePayload(current);
        return next(conflict);
    }

    const updates = flattenUpdates(req.body);
    const consentEntries = buildConsentAudit(current?.notifications, req.body.notifications);
    let updated;

    if (!current) {
        try {
            updated = await AccountPreference.create({
                ownerKey,
                schemaVersion: SCHEMA_VERSION,
                revision: 1,
                ...req.body,
                version: undefined,
                consentAudit: consentEntries,
            });
        } catch (error) {
            if (error?.code === 11000) {
                const conflict = new AppError('Preferences changed in another session. Refresh and try again.', 409);
                conflict.code = 'ACCOUNT_PREFERENCES_VERSION_CONFLICT';
                return next(conflict);
            }
            throw error;
        }
    } else {
        const updateOperation = {
            $set: updates,
            $inc: { revision: 1 },
        };
        if (consentEntries.length > 0) {
            updateOperation.$push = {
                consentAudit: {
                    $each: consentEntries,
                    $slice: -100,
                },
            };
        }
        updated = await AccountPreference.findOneAndUpdate(
            { ownerKey, revision: expectedVersion },
            updateOperation,
            { returnDocument: 'after' }
        );
        if (!updated) {
            const conflict = new AppError('Preferences changed in another session. Refresh and try again.', 409);
            conflict.code = 'ACCOUNT_PREFERENCES_VERSION_CONFLICT';
            return next(conflict);
        }
    }

    recordAuthSecurityEvent({
        event: 'account.preferences.updated',
        outcome: 'success',
        reason: 'user_requested',
        surface: 'data',
        req,
        meta: {
            groups: ['notifications', 'localization', 'accessibility']
                .filter((group) => Boolean(req.body[group])),
            consentChanges: consentEntries.length,
        },
    });

    res.json({
        success: true,
        preferences: toPreferencePayload(updated),
    });
});

module.exports = {
    getAccountPreferences,
    updateAccountPreferences,
    toPreferencePayload,
};
