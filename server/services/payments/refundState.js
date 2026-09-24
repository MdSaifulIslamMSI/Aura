const { PAYMENT_STATUSES } = require('./constants');
const {
    roundCurrency,
    toMinorUnits,
    fromMinorUnits,
} = require('./helpers');
const {
    buildRefundEntryMinorUnits,
    buildRefundSummaryMinorUnits,
} = require('./moneyStorage');

const getSettlementCurrency = (order = {}) => String(order?.settlementCurrency || 'INR').trim().toUpperCase() || 'INR';
const getPresentmentCurrency = (order = {}) => (
    String(order?.presentmentCurrency || getSettlementCurrency(order)).trim().toUpperCase()
    || getSettlementCurrency(order)
);
const getSettlementTotal = (order = {}) => roundCurrency(
    Number(order?.settlementAmount ?? order?.totalPrice ?? 0),
    getSettlementCurrency(order)
);
const getPresentmentTotal = (order = {}) => roundCurrency(
    Number(order?.presentmentTotalPrice ?? order?.totalPrice ?? 0),
    getPresentmentCurrency(order)
);
const getSettlementRefunded = (order = {}) => roundCurrency(
    Number(order?.refundSummary?.totalRefunded || 0),
    getSettlementCurrency(order)
);
const getPresentmentRefunded = (order = {}) => roundCurrency(
    Number(order?.refundSummary?.presentmentTotalRefunded || 0),
    getPresentmentCurrency(order)
);
const SUCCESSFUL_REFUND_STATUSES = new Set(['processed', 'succeeded', 'success', 'completed', 'refunded', 'confirmed']);
const normalizeRefundStatus = (value) => {
    const status = String(value || 'pending').trim().toLowerCase();
    if (SUCCESSFUL_REFUND_STATUSES.has(status)) return 'processed';
    if (['failed', 'cancelled', 'canceled', 'rejected'].includes(status)) return 'failed';
    return 'pending';
};
const isSuccessfulRefundStatus = (value) => normalizeRefundStatus(value) === 'processed';
const getRefundCommandStatus = (value) => {
    const status = normalizeRefundStatus(value);
    if (status === 'processed') return 'processed';
    if (status === 'failed') return 'rejected';
    return 'pending';
};

const calculateRefundable = (order) => {
    const refunded = getSettlementRefunded(order);
    return Math.max(roundCurrency(getSettlementTotal(order) - refunded, getSettlementCurrency(order)), 0);
};

const calculatePresentmentRefundable = (order) => {
    const refunded = getPresentmentRefunded(order);
    return Math.max(roundCurrency(getPresentmentTotal(order) - refunded, getPresentmentCurrency(order)), 0);
};

const convertRefundAmount = ({
    value,
    valueCurrency,
    targetCurrency,
    sourceTotal,
    targetTotal,
    remainingTarget,
    isFinalRemainder = false,
}) => {
    if (valueCurrency === targetCurrency) {
        return roundCurrency(value, targetCurrency);
    }

    if (isFinalRemainder) {
        return roundCurrency(remainingTarget, targetCurrency);
    }

    const sourceMinor = Number(toMinorUnits(sourceTotal, valueCurrency));
    const targetMinor = Number(toMinorUnits(targetTotal, targetCurrency));
    const remainingTargetMinor = Number(toMinorUnits(remainingTarget, targetCurrency));
    const requestedMinor = Number(toMinorUnits(value, valueCurrency));

    if (sourceMinor <= 0 || targetMinor <= 0 || requestedMinor <= 0 || remainingTargetMinor <= 0) {
        return 0;
    }

    const proportionalMinor = Math.max(
        1,
        Math.round((requestedMinor / sourceMinor) * targetMinor)
    );

    return fromMinorUnits(
        Math.min(proportionalMinor, remainingTargetMinor),
        targetCurrency
    );
};

const resolveRefundAmounts = ({
    order,
    amount,
    amountMode = 'settlement',
} = {}) => {
    const settlementCurrency = getSettlementCurrency(order);
    const presentmentCurrency = getPresentmentCurrency(order);
    const settlementTotal = getSettlementTotal(order);
    const presentmentTotal = getPresentmentTotal(order);
    const remainingSettlement = calculateRefundable(order);
    const remainingPresentment = calculatePresentmentRefundable(order);

    if (remainingSettlement <= 0 || remainingPresentment <= 0) {
        return {
            settlementCurrency,
            presentmentCurrency,
            remainingSettlement: 0,
            remainingPresentment: 0,
            settlementAmount: 0,
            presentmentAmount: 0,
        };
    }

    if (amount === undefined || amount === null) {
        return {
            settlementCurrency,
            presentmentCurrency,
            remainingSettlement,
            remainingPresentment,
            settlementAmount: remainingSettlement,
            presentmentAmount: remainingPresentment,
        };
    }

    if (amountMode === 'charge') {
        const presentmentAmount = roundCurrency(amount, presentmentCurrency);
        if (presentmentAmount <= 0) {
            throw new Error('Refund amount must be positive');
        }
        if (presentmentAmount - remainingPresentment > 0.01) {
            throw new Error('Refund amount exceeds refundable charge balance');
        }
        const isFinalRemainder = Math.abs(presentmentAmount - remainingPresentment) <= 0.01;
        const settlementAmount = convertRefundAmount({
            value: presentmentAmount,
            valueCurrency: presentmentCurrency,
            targetCurrency: settlementCurrency,
            sourceTotal: presentmentTotal,
            targetTotal: settlementTotal,
            remainingTarget: remainingSettlement,
            isFinalRemainder,
        });

        return {
            settlementCurrency,
            presentmentCurrency,
            remainingSettlement,
            remainingPresentment,
            settlementAmount: isFinalRemainder ? remainingSettlement : settlementAmount,
            presentmentAmount,
        };
    }

    const settlementAmount = roundCurrency(amount, settlementCurrency);
    if (settlementAmount <= 0) {
        throw new Error('Refund amount must be positive');
    }
    if (settlementAmount - remainingSettlement > 0.01) {
        throw new Error('Refund amount exceeds refundable settlement balance');
    }
    const isFinalRemainder = Math.abs(settlementAmount - remainingSettlement) <= 0.01;
    const presentmentAmount = convertRefundAmount({
        value: settlementAmount,
        valueCurrency: settlementCurrency,
        targetCurrency: presentmentCurrency,
        sourceTotal: settlementTotal,
        targetTotal: presentmentTotal,
        remainingTarget: remainingPresentment,
        isFinalRemainder,
    });

    return {
        settlementCurrency,
        presentmentCurrency,
        remainingSettlement,
        remainingPresentment,
        settlementAmount,
        presentmentAmount: isFinalRemainder ? remainingPresentment : presentmentAmount,
    };
};

const buildRefundEntry = ({
    providerRefund,
    refundAmounts,
    reason,
    requestId = '',
    fallbackRefundId,
    createdAt = new Date(),
}) => {
    const entry = {
        refundId: providerRefund?.id || fallbackRefundId,
        ...(requestId ? { requestId: String(requestId) } : {}),
        amount: refundAmounts?.presentmentAmount ?? refundAmounts?.settlementAmount ?? 0,
        currency: refundAmounts?.presentmentCurrency || refundAmounts?.settlementCurrency || 'INR',
        settlementAmount: refundAmounts?.settlementAmount ?? 0,
        settlementCurrency: refundAmounts?.settlementCurrency || 'INR',
        presentmentAmount: refundAmounts?.presentmentAmount ?? refundAmounts?.settlementAmount ?? 0,
        presentmentCurrency: refundAmounts?.presentmentCurrency || refundAmounts?.settlementCurrency || 'INR',
        reason: reason || 'requested_by_user',
        status: normalizeRefundStatus(providerRefund?.status),
        createdAt,
    };

    return {
        ...entry,
        ...buildRefundEntryMinorUnits(entry),
    };
};

const buildRefundMutation = ({
    order,
    refundEntry,
}) => {
    const settlementCurrency = getSettlementCurrency(order);
    const presentmentCurrency = getPresentmentCurrency(order);
    const normalizedRefundEntry = {
        ...refundEntry,
        ...buildRefundEntryMinorUnits(refundEntry),
    };
    const normalizedPreviousRefunds = (order?.refundSummary?.refunds || []).map((refund) => ({
        ...refund,
        ...buildRefundEntryMinorUnits(refund),
    }));
    const successful = isSuccessfulRefundStatus(refundEntry?.status);
    const previousTotalRefunded = getSettlementRefunded(order);
    const previousPresentmentTotalRefunded = getPresentmentRefunded(order);
    const nextTotalRefunded = successful
        ? roundCurrency(previousTotalRefunded + Number(refundEntry?.settlementAmount || 0), settlementCurrency)
        : previousTotalRefunded;
    const nextPresentmentTotalRefunded = successful
        ? roundCurrency(previousPresentmentTotalRefunded + Number(refundEntry?.presentmentAmount || 0), presentmentCurrency)
        : previousPresentmentTotalRefunded;
    const orderTotal = getSettlementTotal(order);
    const orderPresentmentTotal = getPresentmentTotal(order);
    const fullyRefunded = successful && (
        (Math.abs(nextTotalRefunded - orderTotal) <= 0.01 || nextTotalRefunded > orderTotal)
        && (
            Math.abs(nextPresentmentTotalRefunded - orderPresentmentTotal) <= 0.01
            || nextPresentmentTotalRefunded > orderPresentmentTotal
        )
    );
    const paymentState = successful
        ? (fullyRefunded ? PAYMENT_STATUSES.REFUNDED : PAYMENT_STATUSES.PARTIALLY_REFUNDED)
        : String(order?.paymentState || PAYMENT_STATUSES.CAPTURED);
    const refundSummary = {
        totalRefunded: nextTotalRefunded,
        settlementCurrency,
        presentmentCurrency,
        presentmentTotalRefunded: nextPresentmentTotalRefunded,
        fullyRefunded: successful ? fullyRefunded : Boolean(order?.refundSummary?.fullyRefunded),
        refunds: [...normalizedPreviousRefunds, normalizedRefundEntry],
    };

    return {
        nextTotalRefunded,
        nextPresentmentTotalRefunded,
        fullyRefunded: refundSummary.fullyRefunded,
        paymentState,
        refundSummary: {
            ...refundSummary,
            ...buildRefundSummaryMinorUnits(refundSummary),
        },
    };
};

module.exports = {
    calculateRefundable,
    calculatePresentmentRefundable,
    resolveRefundAmounts,
    buildRefundEntry,
    buildRefundMutation,
    getRefundCommandStatus,
};
