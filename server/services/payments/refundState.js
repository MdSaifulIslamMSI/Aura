const { PAYMENT_STATUSES } = require('./constants');
const {
    roundCurrency,
    toMinorUnits,
    fromMinorUnits,
} = require('./helpers');

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
    fallbackRefundId,
    createdAt = new Date(),
}) => ({
    refundId: providerRefund?.id || fallbackRefundId,
    amount: refundAmounts?.presentmentAmount ?? refundAmounts?.settlementAmount ?? 0,
    currency: refundAmounts?.presentmentCurrency || refundAmounts?.settlementCurrency || 'INR',
    settlementAmount: refundAmounts?.settlementAmount ?? 0,
    settlementCurrency: refundAmounts?.settlementCurrency || 'INR',
    presentmentAmount: refundAmounts?.presentmentAmount ?? refundAmounts?.settlementAmount ?? 0,
    presentmentCurrency: refundAmounts?.presentmentCurrency || refundAmounts?.settlementCurrency || 'INR',
    reason: reason || 'requested_by_user',
    status: String(providerRefund?.status || 'processed'),
    createdAt,
});

const buildRefundMutation = ({
    order,
    refundEntry,
}) => {
    const settlementCurrency = getSettlementCurrency(order);
    const presentmentCurrency = getPresentmentCurrency(order);
    const nextTotalRefunded = roundCurrency(
        getSettlementRefunded(order) + Number(refundEntry?.settlementAmount || 0),
        settlementCurrency
    );
    const nextPresentmentTotalRefunded = roundCurrency(
        getPresentmentRefunded(order) + Number(refundEntry?.presentmentAmount || 0),
        presentmentCurrency
    );
    const orderTotal = getSettlementTotal(order);
    const orderPresentmentTotal = getPresentmentTotal(order);
    const fullyRefunded = (
        Math.abs(nextTotalRefunded - orderTotal) <= 0.01 || nextTotalRefunded > orderTotal
    ) && (
        Math.abs(nextPresentmentTotalRefunded - orderPresentmentTotal) <= 0.01
        || nextPresentmentTotalRefunded > orderPresentmentTotal
    );
    const paymentState = fullyRefunded
        ? PAYMENT_STATUSES.REFUNDED
        : PAYMENT_STATUSES.PARTIALLY_REFUNDED;

    return {
        nextTotalRefunded,
        nextPresentmentTotalRefunded,
        fullyRefunded,
        paymentState,
        refundSummary: {
            totalRefunded: nextTotalRefunded,
            settlementCurrency,
            presentmentCurrency,
            presentmentTotalRefunded: nextPresentmentTotalRefunded,
            fullyRefunded,
            refunds: [...(order?.refundSummary?.refunds || []), refundEntry],
        },
    };
};

module.exports = {
    calculateRefundable,
    calculatePresentmentRefundable,
    resolveRefundAmounts,
    buildRefundEntry,
    buildRefundMutation,
};
