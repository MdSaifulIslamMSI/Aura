const {
    normalizeCurrencyCode,
    toMinorUnits,
} = require('./helpers');

const hasStoredMoneyValue = (value) => (
    value !== undefined
    && value !== null
    && value !== ''
);

const toStoredMinorUnits = (value, currency = 'INR', {
    nullOnMissing = false,
} = {}) => {
    if (!hasStoredMoneyValue(value)) {
        return nullOnMissing ? null : 0;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return nullOnMissing ? null : 0;
    }

    const normalizedCurrency = normalizeCurrencyCode(currency || 'INR');
    const minorUnits = toMinorUnits(Math.max(numeric, 0), normalizedCurrency);
    if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
        return nullOnMissing ? null : 0;
    }

    return minorUnits;
};

const minorUnitsField = (defaultValue = 0) => ({
    type: Number,
    default: defaultValue,
    min: 0,
    validate: {
        validator(value) {
            return value === null || value === undefined || Number.isSafeInteger(value);
        },
        message: 'Minor-unit money fields must be safe integers.',
    },
});

const buildPaymentIntentMinorUnits = ({
    amount,
    currency,
    baseAmount,
    baseCurrency,
    displayAmount,
    displayCurrency,
    settlementAmount,
    settlementCurrency,
    providerBaseAmount,
    providerBaseCurrency,
} = {}) => ({
    amountMinor: toStoredMinorUnits(amount, currency),
    baseAmountMinor: toStoredMinorUnits(baseAmount ?? amount, baseCurrency || currency),
    displayAmountMinor: toStoredMinorUnits(displayAmount ?? amount, displayCurrency || currency),
    settlementAmountMinor: toStoredMinorUnits(settlementAmount ?? amount, settlementCurrency || currency),
    providerBaseAmountMinor: toStoredMinorUnits(
        providerBaseAmount,
        providerBaseCurrency || settlementCurrency || currency,
        { nullOnMissing: true }
    ),
});

const hydratePaymentIntentMinorUnits = (intent = {}) => {
    Object.assign(intent, buildPaymentIntentMinorUnits(intent));
    return intent;
};

const buildOrderPricingMinorUnits = ({
    itemsPrice,
    taxPrice,
    shippingPrice,
    totalPrice,
    baseAmount,
    baseCurrency,
    displayAmount,
    displayCurrency,
    settlementAmount,
    settlementCurrency,
    presentmentTotalPrice,
    presentmentCurrency,
    couponDiscount,
    paymentAdjustment,
} = {}) => {
    const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency || settlementCurrency || 'INR');
    const normalizedDisplayCurrency = normalizeCurrencyCode(displayCurrency || presentmentCurrency || normalizedBaseCurrency);
    const normalizedSettlementCurrency = normalizeCurrencyCode(settlementCurrency || normalizedBaseCurrency);
    const normalizedPresentmentCurrency = normalizeCurrencyCode(presentmentCurrency || normalizedDisplayCurrency);

    return {
        itemsPriceMinor: toStoredMinorUnits(itemsPrice, normalizedBaseCurrency),
        taxPriceMinor: toStoredMinorUnits(taxPrice, normalizedBaseCurrency),
        shippingPriceMinor: toStoredMinorUnits(shippingPrice, normalizedBaseCurrency),
        totalPriceMinor: toStoredMinorUnits(totalPrice, normalizedBaseCurrency),
        baseAmountMinor: toStoredMinorUnits(baseAmount ?? totalPrice, normalizedBaseCurrency),
        displayAmountMinor: toStoredMinorUnits(displayAmount ?? presentmentTotalPrice ?? totalPrice, normalizedDisplayCurrency),
        settlementAmountMinor: toStoredMinorUnits(settlementAmount ?? totalPrice, normalizedSettlementCurrency),
        presentmentTotalPriceMinor: toStoredMinorUnits(presentmentTotalPrice ?? displayAmount ?? totalPrice, normalizedPresentmentCurrency),
        couponDiscountMinor: toStoredMinorUnits(couponDiscount, normalizedBaseCurrency),
        paymentAdjustmentMinor: toStoredMinorUnits(paymentAdjustment, normalizedBaseCurrency),
    };
};

const buildOrderItemMinorUnits = (item = {}, currency = 'INR') => ({
    priceMinor: toStoredMinorUnits(item.price, currency),
});

const buildRefundEntryMinorUnits = ({
    amount,
    currency,
    settlementAmount,
    settlementCurrency,
    presentmentAmount,
    presentmentCurrency,
} = {}) => ({
    amountMinor: toStoredMinorUnits(
        amount ?? presentmentAmount ?? settlementAmount,
        currency || presentmentCurrency || settlementCurrency || 'INR'
    ),
    settlementAmountMinor: toStoredMinorUnits(settlementAmount ?? amount, settlementCurrency || currency || 'INR'),
    presentmentAmountMinor: toStoredMinorUnits(
        presentmentAmount ?? amount ?? settlementAmount,
        presentmentCurrency || currency || settlementCurrency || 'INR'
    ),
});

const buildRefundSummaryMinorUnits = ({
    totalRefunded,
    settlementCurrency,
    presentmentTotalRefunded,
    presentmentCurrency,
} = {}) => ({
    totalRefundedMinor: toStoredMinorUnits(totalRefunded, settlementCurrency || 'INR'),
    presentmentTotalRefundedMinor: toStoredMinorUnits(
        presentmentTotalRefunded,
        presentmentCurrency || settlementCurrency || 'INR'
    ),
});

const hydrateOrderMinorUnits = (order = {}) => {
    const baseCurrency = normalizeCurrencyCode(order.baseCurrency || order.settlementCurrency || 'INR');
    Object.assign(order, buildOrderPricingMinorUnits(order));

    if (Array.isArray(order.orderItems)) {
        order.orderItems.forEach((item) => {
            Object.assign(item, buildOrderItemMinorUnits(item, baseCurrency));
        });
    }

    if (order.refundSummary) {
        Object.assign(order.refundSummary, buildRefundSummaryMinorUnits(order.refundSummary));
        if (Array.isArray(order.refundSummary.refunds)) {
            order.refundSummary.refunds.forEach((refund) => {
                Object.assign(refund, buildRefundEntryMinorUnits(refund));
            });
        }
    }

    if (Array.isArray(order.commandCenter?.refunds)) {
        const settlementCurrency = normalizeCurrencyCode(order.settlementCurrency || order.refundSummary?.settlementCurrency || 'INR');
        order.commandCenter.refunds.forEach((refund) => {
            refund.amountMinor = toStoredMinorUnits(refund.amount, settlementCurrency);
        });
    }

    return order;
};

module.exports = {
    minorUnitsField,
    toStoredMinorUnits,
    buildPaymentIntentMinorUnits,
    hydratePaymentIntentMinorUnits,
    buildOrderPricingMinorUnits,
    buildOrderItemMinorUnits,
    buildRefundEntryMinorUnits,
    buildRefundSummaryMinorUnits,
    hydrateOrderMinorUnits,
};
