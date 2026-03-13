const AppError = require('../../utils/AppError');

const diff = (a, b) => Math.abs(Number(a) - Number(b));

const buildSecurityState = (intent) => {
    const state = intent?.metadata?.securityLayer || {};
    return {
        failedConfirmAttempts: Number(state.failedConfirmAttempts || 0),
        totalConfirmFailures: Number(state.totalConfirmFailures || 0),
        lastConfirmFailedAt: state.lastConfirmFailedAt || null,
        lastConfirmFailureReason: String(state.lastConfirmFailureReason || ''),
        lockedUntil: state.lockedUntil || null,
    };
};

const setSecurityState = (intent, nextState = {}) => {
    const current = buildSecurityState(intent);
    intent.metadata = {
        ...(intent.metadata || {}),
        securityLayer: {
            ...current,
            ...nextState,
        },
    };
    if (typeof intent.markModified === 'function') {
        intent.markModified('metadata');
    }
};

const getLockUntilDate = (intent) => {
    const state = buildSecurityState(intent);
    const lockedUntil = state.lockedUntil ? new Date(state.lockedUntil) : null;
    if (!lockedUntil || Number.isNaN(lockedUntil.getTime())) return null;
    return lockedUntil;
};

const assertQuoteMatches = (quoteSnapshot, totalPrice) => {
    if (!quoteSnapshot || quoteSnapshot.totalPrice === undefined || quoteSnapshot.totalPrice === null) {
        return;
    }
    if (diff(quoteSnapshot.totalPrice, totalPrice) > 0.01) {
        throw new AppError('Quote expired. Please recalculate before payment.', 409);
    }
};

const isIntentExpired = (intent) => intent?.expiresAt && new Date(intent.expiresAt).getTime() < Date.now();

const assertConfirmNotLocked = (intent) => {
    const lockedUntil = getLockUntilDate(intent);
    if (!lockedUntil) return;

    if (lockedUntil.getTime() > Date.now()) {
        const retryAfterSeconds = Math.max(Math.ceil((lockedUntil.getTime() - Date.now()) / 1000), 1);
        throw new AppError(
            `Payment confirmation temporarily locked due to suspicious attempts. Retry after ${retryAfterSeconds} seconds.`,
            429
        );
    }
};

module.exports = {
    diff,
    buildSecurityState,
    setSecurityState,
    getLockUntilDate,
    assertQuoteMatches,
    isIntentExpired,
    assertConfirmNotLocked,
};
