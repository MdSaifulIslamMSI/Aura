const mongoose = require('mongoose');
const User = require('../models/User');
const AuthSecurityEventOutbox = require('../models/AuthSecurityEventOutbox');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
    getAllTrackedSessionIdsForUser,
    loadSessionRecord,
} = require('./browserSessionService');
const { evaluateAccountLockout } = require('./loginLockoutService');

// Admin assurance overview (B4): aggregates a user's authentication posture
// for support/incident triage from existing sources. Read-only; redacted;
// never throws secrets. All inputs already exist — this only joins them.

const MAX_OVERVIEW_SESSIONS = 100;
const MAX_OVERVIEW_EVENTS = 10;

const maskAccountEmail = (email = '') => {
    const value = String(email || '').trim();
    const at = value.indexOf('@');
    if (at <= 0) return '';
    return `${value.slice(0, 2)}***${value.slice(at)}`;
};

const countActiveStepUp = (records = [], now = Date.now()) => records.filter((record) => {
    const stepUpMs = record?.stepUpUntil ? new Date(record.stepUpUntil).getTime() : 0;
    const webAuthnMs = record?.webAuthnStepUpUntil ? new Date(record.webAuthnStepUpUntil).getTime() : 0;
    return stepUpMs > now || webAuthnMs > now;
}).length;

const resolveUserAssuranceOverview = async ({ userId = '' } = {}) => {
    const normalizedUserId = String(userId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(normalizedUserId)) {
        throw new AppError('User not found.', 404);
    }

    const user = await User.findById(
        normalizedUserId,
        'name email isAdmin adminRoles isVerified accountState trustedDevices mfa recoveryCodeState'
    ).lean();
    if (!user) {
        throw new AppError('User not found.', 404);
    }

    const activePasskeys = Array.isArray(user?.mfa?.passkeys)
        ? user.mfa.passkeys.filter((entry) => !entry?.revokedAt)
        : [];

    let sessionIds = [];
    try {
        sessionIds = await getAllTrackedSessionIdsForUser(normalizedUserId);
    } catch (error) {
        logger.warn('admin.assurance.sessions_unavailable', { error: error?.message || 'unknown' });
    }
    const sampledIds = sessionIds.slice(0, MAX_OVERVIEW_SESSIONS);
    const records = [];
    for (const sessionId of sampledIds) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const record = await loadSessionRecord(sessionId);
            if (record) records.push(record);
        } catch {
            // Skip unreadable sessions; inventory is best-effort.
        }
    }

    let lockout = { locked: false, failures: 0 };
    try {
        const state = await evaluateAccountLockout({ uid: normalizedUserId, email: user.email || '' });
        lockout = { locked: Boolean(state.locked), failures: Number(state.failures || 0) };
    } catch (error) {
        logger.warn('admin.assurance.lockout_unavailable', { error: error?.message || 'unknown' });
    }

    let recentEvents = [];
    try {
        const docs = await AuthSecurityEventOutbox.find({ 'payload.userId': normalizedUserId })
            .select('payload.event payload.outcome payload.occurredAt createdAt')
            .sort({ createdAt: -1 })
            .limit(MAX_OVERVIEW_EVENTS)
            .lean();
        recentEvents = docs.map((doc) => ({
            event: doc.payload?.event || '',
            outcome: doc.payload?.outcome || '',
            occurredAt: doc.payload?.occurredAt || doc.createdAt,
        }));
    } catch (error) {
        logger.warn('admin.assurance.events_unavailable', { error: error?.message || 'unknown' });
    }

    return {
        user: {
            id: String(user._id),
            email: maskAccountEmail(user.email),
            isAdmin: Boolean(user.isAdmin),
            adminRoles: Array.isArray(user.adminRoles) ? user.adminRoles : [],
            isVerified: Boolean(user.isVerified),
            accountState: String(user.accountState || ''),
        },
        mfa: {
            totpEnabled: Boolean(user?.mfa?.totp?.enabled && user?.mfa?.totp?.confirmedAt),
            passkeys: activePasskeys.length,
            recoveryCodes: Math.max(Number(user?.recoveryCodeState?.activeCount || 0), 0),
        },
        trustedDevices: Array.isArray(user.trustedDevices) ? user.trustedDevices.length : 0,
        sessions: {
            tracked: sessionIds.length,
            sampled: records.length,
            steppedUp: countActiveStepUp(records),
        },
        lockout,
        recentEvents,
    };
};

module.exports = {
    MAX_OVERVIEW_EVENTS,
    MAX_OVERVIEW_SESSIONS,
    resolveUserAssuranceOverview,
};
