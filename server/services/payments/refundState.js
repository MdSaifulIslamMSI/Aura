const { PAYMENT_STATUSES } = require('./constants');
const { roundCurrency } = require('./helpers');

const calculateRefundable = (order) => {
    const refunded = Number(order?.refundSummary?.totalRefunded || 0);
    return Math.max(roundCurrency(Number(order?.totalPrice || 0) - refunded), 0);
};

const buildRefundEntry = ({
    providerRefund,
    requestedAmount,
    reason,
    fallbackRefundId,
    createdAt = new Date(),
}) => ({
    refundId: providerRefund?.id || fallbackRefundId,
    amount: requestedAmount,
    reason: reason || 'requested_by_user',
    status: String(providerRefund?.status || 'processed'),
    createdAt,
});

const buildRefundMutation = ({
    order,
    requestedAmount,
    refundEntry,
}) => {
    const nextTotalRefunded = roundCurrency(
        Number(order?.refundSummary?.totalRefunded || 0) + Number(requestedAmount || 0)
    );
    const orderTotal = Number(order?.totalPrice || 0);
    const fullyRefunded = Math.abs(nextTotalRefunded - orderTotal) <= 0.01 || nextTotalRefunded > orderTotal;
    const paymentState = fullyRefunded
        ? PAYMENT_STATUSES.REFUNDED
        : PAYMENT_STATUSES.PARTIALLY_REFUNDED;

    return {
        nextTotalRefunded,
        fullyRefunded,
        paymentState,
        refundSummary: {
            totalRefunded: nextTotalRefunded,
            fullyRefunded,
            refunds: [...(order?.refundSummary?.refunds || []), refundEntry],
        },
    };
};

module.exports = {
    calculateRefundable,
    buildRefundEntry,
    buildRefundMutation,
};
