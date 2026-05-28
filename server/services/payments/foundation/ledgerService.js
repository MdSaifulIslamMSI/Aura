const crypto = require('crypto');
const { PaymentDomainError } = require('./domainErrors');
const { assertMinorUnitMoney } = require('./providerContract');

const DIRECTION = Object.freeze({
    debit: 'debit',
    credit: 'credit',
});

const accountNames = Object.freeze({
    platformCash: 'platform:cash',
    platformFees: 'platform:fees',
    platformRevenue: 'platform:revenue',
    platformTax: 'platform:tax',
    processorClearing: (provider) => `processor:${provider}:clearing`,
    userReceivable: (userId) => `user:${userId}:receivable`,
    userWallet: (userId) => `user:${userId}:wallet`,
    refundsPending: 'refunds:pending',
    disputesPending: 'disputes:pending',
});

const assertLedgerEntry = (entry) => {
    if (!entry || typeof entry !== 'object') {
        throw PaymentDomainError.invalidInput('Ledger entry must be an object.');
    }
    if (!entry.account || typeof entry.account !== 'string') {
        throw PaymentDomainError.invalidInput('Ledger entry account is required.');
    }
    if (!Object.values(DIRECTION).includes(entry.direction)) {
        throw PaymentDomainError.invalidInput('Ledger entry direction must be debit or credit.');
    }
    assertMinorUnitMoney({ amountMinor: entry.amountMinor, currency: entry.currency });
};

const balanceByCurrency = (entries) => entries.reduce((balances, entry) => {
    const current = balances.get(entry.currency) || 0;
    const signed = entry.direction === DIRECTION.debit ? entry.amountMinor : -entry.amountMinor;
    balances.set(entry.currency, current + signed);
    return balances;
}, new Map());

const assertBalanced = (entries) => {
    if (!Array.isArray(entries) || entries.length < 2) {
        throw PaymentDomainError.invalidInput('Ledger transaction requires at least two entries.');
    }
    entries.forEach(assertLedgerEntry);
    const balances = balanceByCurrency(entries);
    const imbalanced = [...balances.entries()].filter(([, balance]) => balance !== 0);
    if (imbalanced.length > 0) {
        throw PaymentDomainError.invalidInput('Ledger transaction must balance to zero per currency.', {
            balances: Object.fromEntries(imbalanced),
        });
    }
};

const freezeEntry = (entry) => Object.freeze({
    account: entry.account,
    direction: entry.direction,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    memo: entry.memo,
    metadata: Object.freeze({ ...(entry.metadata || {}) }),
});

const deterministicId = (prefix, value) => {
    const hash = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
    return `${prefix}_${hash}`;
};

const createLedgerTransaction = ({
    transactionId,
    sourceType,
    sourceId,
    description,
    entries,
    metadata = {},
    createdAt = new Date(),
}) => {
    const frozenEntries = entries.map(freezeEntry);
    assertBalanced(frozenEntries);
    return Object.freeze({
        transactionId: transactionId || deterministicId('ledger_txn', { sourceType, sourceId, entries: frozenEntries }),
        sourceType,
        sourceId,
        description,
        entries: Object.freeze(frozenEntries),
        metadata: Object.freeze({ ...metadata }),
        createdAt: createdAt.toISOString(),
        immutable: true,
    });
};

const buildPaymentSuccessTransaction = ({
    paymentIntentId,
    userId,
    provider,
    amountMinor,
    currency,
    feeMinor = 0,
    taxMinor = 0,
}) => {
    assertMinorUnitMoney({ amountMinor, currency });
    if (!Number.isSafeInteger(feeMinor) || feeMinor < 0 || !Number.isSafeInteger(taxMinor) || taxMinor < 0) {
        throw PaymentDomainError.invalidInput('Fee and tax amounts must be non-negative integer minor units.');
    }
    if (feeMinor + taxMinor > amountMinor) {
        throw PaymentDomainError.invalidInput('Fee and tax cannot exceed payment amount.');
    }

    const revenueMinor = amountMinor - feeMinor - taxMinor;
    const entries = [
        {
            account: accountNames.processorClearing(provider),
            direction: DIRECTION.debit,
            amountMinor,
            currency,
            memo: 'Processor clearing receivable',
        },
        {
            account: accountNames.platformRevenue,
            direction: DIRECTION.credit,
            amountMinor: revenueMinor,
            currency,
            memo: 'Platform revenue recognized',
        },
    ];

    if (taxMinor > 0) {
        entries.push({
            account: accountNames.platformTax,
            direction: DIRECTION.credit,
            amountMinor: taxMinor,
            currency,
            memo: 'Tax liability recognized',
        });
    }

    if (feeMinor > 0) {
        entries.push({
            account: accountNames.platformFees,
            direction: DIRECTION.credit,
            amountMinor: feeMinor,
            currency,
            memo: 'Processor fee allocation',
        });
    }

    return createLedgerTransaction({
        sourceType: 'payment_intent',
        sourceId: paymentIntentId,
        description: `Payment success for ${paymentIntentId}`,
        entries,
        metadata: { userId, provider },
    });
};

const buildRefundTransaction = ({
    refundId,
    paymentIntentId,
    userId,
    provider,
    amountMinor,
    currency,
}) => {
    assertMinorUnitMoney({ amountMinor, currency });
    return createLedgerTransaction({
        sourceType: 'refund',
        sourceId: refundId,
        description: `Refund for ${paymentIntentId}`,
        entries: [
            {
                account: accountNames.platformRevenue,
                direction: DIRECTION.debit,
                amountMinor,
                currency,
                memo: 'Revenue reversal',
            },
            {
                account: accountNames.processorClearing(provider),
                direction: DIRECTION.credit,
                amountMinor,
                currency,
                memo: 'Processor refund payable',
            },
        ],
        metadata: { paymentIntentId, userId, provider },
    });
};

module.exports = {
    DIRECTION,
    accountNames,
    assertBalanced,
    createLedgerTransaction,
    buildPaymentSuccessTransaction,
    buildRefundTransaction,
};
