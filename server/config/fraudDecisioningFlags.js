const SUPPORTED_FRAUD_MODES = Object.freeze(['off', 'monitor', 'shadow', 'enforce']);

const safeLower = (value, fallback = '') => String(value || fallback).trim().toLowerCase();

const parseFraudMode = (value, fallback = 'monitor') => {
    const normalized = safeLower(value, fallback);
    return SUPPORTED_FRAUD_MODES.includes(normalized) ? normalized : fallback;
};

const flags = {
    fraudDecisioningMode: parseFraudMode(process.env.FRAUD_DECISIONING_MODE, 'monitor'),
    marketplaceFraudMode: parseFraudMode(process.env.MARKETPLACE_FRAUD_MODE, 'enforce'),
    postPurchaseFraudMode: parseFraudMode(process.env.POST_PURCHASE_FRAUD_MODE, 'enforce'),
    reviewFraudMode: parseFraudMode(process.env.REVIEW_FRAUD_MODE, 'enforce'),
    fraudDecisionAuditEnabled: safeLower(process.env.FRAUD_DECISION_AUDIT_ENABLED, 'true') !== 'false',
};

module.exports = {
    SUPPORTED_FRAUD_MODES,
    flags,
    parseFraudMode,
};
