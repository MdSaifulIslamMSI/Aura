const { safeString } = require('./assistantContract');

const SUPPORT_CATEGORY_RULES = [
    { pattern: /\b(return|refund|replacement|replace|exchange|damaged|broken|defect)\b/i, category: 'returns' },
    { pattern: /\b(order|track|tracking|delivery|shipment|cancel order|late|delay)\b/i, category: 'orders' },
    { pattern: /\b(payment|billing|upi|card|transaction|emi|invoice)\b/i, category: 'payments' },
    { pattern: /\b(login|account|password|security|access|suspended)\b/i, category: 'account' },
];

const buildSupportDraft = ({ message = '', routeContext = {}, session = {} } = {}) => {
    const normalizedMessage = safeString(message);
    const category = SUPPORT_CATEGORY_RULES.find((rule) => rule.pattern.test(normalizedMessage))?.category || 'general';
    const subjectTail = normalizedMessage
        ? normalizedMessage.replace(/\s+/g, ' ').slice(0, 72)
        : `Help from ${safeString(routeContext?.label || 'shopping flow')}`;
    const relatedOrderId = safeString(routeContext?.entityType === 'orders' ? routeContext?.entityId : '');

    return {
        category,
        subject: `Support: ${subjectTail}`.slice(0, 96),
        body: normalizedMessage || `Need help from ${safeString(routeContext?.label || 'shopping flow')}.`,
        relatedOrderId: relatedOrderId || safeString(session?.lastSupportDraft?.relatedOrderId || ''),
    };
};

module.exports = {
    buildSupportDraft,
};
