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

const assertQuoteMatches = (quoteSnapshot, pricing) => {
    if (!quoteSnapshot || quoteSnapshot.totalPrice === undefined || quoteSnapshot.totalPrice === null) {
        return;
    }

    if (
        quoteSnapshot.baseAmount !== undefined
        && quoteSnapshot.baseAmount !== null
        && pricing?.baseAmount !== undefined
        && pricing?.baseAmount !== null
        && diff(quoteSnapshot.baseAmount, pricing.baseAmount) > 0.01
    ) {
        throw new AppError('Base currency quote expired. Please recalculate before payment.', 409);
    }

    if (quoteSnapshot.baseCurrency && pricing?.baseCurrency) {
        const expectedBaseCurrency = String(pricing.baseCurrency || '').trim().toUpperCase();
        const actualBaseCurrency = String(quoteSnapshot.baseCurrency || '').trim().toUpperCase();
        if (expectedBaseCurrency && actualBaseCurrency && expectedBaseCurrency !== actualBaseCurrency) {
            throw new AppError('Base currency quote mismatch. Please recalculate before payment.', 409);
        }
    }

    if (
        quoteSnapshot.displayAmount !== undefined
        && quoteSnapshot.displayAmount !== null
        && pricing?.displayAmount !== undefined
        && pricing?.displayAmount !== null
        && diff(quoteSnapshot.displayAmount, pricing.displayAmount) > 0.01
    ) {
        throw new AppError('Display currency quote expired. Please recalculate before payment.', 409);
    }

    if (quoteSnapshot.displayCurrency && pricing?.displayCurrency) {
        const expectedDisplayCurrency = String(pricing.displayCurrency || '').trim().toUpperCase();
        const actualDisplayCurrency = String(quoteSnapshot.displayCurrency || '').trim().toUpperCase();
        if (expectedDisplayCurrency && actualDisplayCurrency && expectedDisplayCurrency !== actualDisplayCurrency) {
            throw new AppError('Display currency quote mismatch. Please recalculate before payment.', 409);
        }
    }

    if (diff(quoteSnapshot.totalPrice, pricing?.totalPrice) > 0.01) {
        throw new AppError('Quote expired. Please recalculate before payment.', 409);
    }

    if (
        quoteSnapshot.presentmentTotalPrice !== undefined
        && quoteSnapshot.presentmentTotalPrice !== null
        && pricing?.presentmentTotalPrice !== undefined
        && pricing?.presentmentTotalPrice !== null
        && diff(quoteSnapshot.presentmentTotalPrice, pricing.presentmentTotalPrice) > 0.01
    ) {
        throw new AppError('Presentment quote expired. Please recalculate before payment.', 409);
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
