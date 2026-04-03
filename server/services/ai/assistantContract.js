const crypto = require('crypto');

const INTENTS = Object.freeze([
    'general_knowledge',
    'product_search',
    'product_selection',
    'cart_action',
    'checkout',
    'navigation',
    'support',
]);

const DECISIONS = Object.freeze(['respond', 'act', 'clarify']);

const ASSISTANT_ACTION_TYPES = Object.freeze([
    'search_products',
    'select_product',
    'add_to_cart',
    'remove_from_cart',
    'go_to_checkout',
    'track_order',
    'navigate_to',
    'open_support',
]);

const UI_SURFACES = Object.freeze([
    'plain_answer',
    'product_results',
    'product_focus',
    'cart_summary',
    'confirmation_card',
    'navigation_notice',
    'support_handoff',
]);

const ANSWER_MODES = Object.freeze([
    'app_grounded',
    'runtime_grounded',
    'model_knowledge',
    'commerce',
]);

const VERIFICATION_LABELS = Object.freeze([
    'app_grounded',
    'runtime_grounded',
    'model_knowledge',
    'cannot_verify',
]);

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const normalizeIntent = (value, fallback = 'general_knowledge') => {
    const normalized = safeString(value, fallback);
    return INTENTS.includes(normalized) ? normalized : fallback;
};

const normalizeDecision = (value, fallback = 'respond') => {
    const normalized = safeString(value, fallback);
    return DECISIONS.includes(normalized) ? normalized : fallback;
};

const normalizeActionType = (value, fallback = '') => {
    const normalized = safeString(value, fallback);
    return ASSISTANT_ACTION_TYPES.includes(normalized) ? normalized : fallback;
};

const normalizeUiSurface = (value, fallback = 'plain_answer') => {
    const normalized = safeString(value, fallback);
    return UI_SURFACES.includes(normalized) ? normalized : fallback;
};

const normalizeAnswerMode = (value, fallback = 'commerce') => {
    const normalized = safeString(value, fallback);
    return ANSWER_MODES.includes(normalized) ? normalized : fallback;
};

const normalizeVerificationLabel = (value, fallback = 'cannot_verify') => {
    const normalized = safeString(value, fallback);
    return VERIFICATION_LABELS.includes(normalized) ? normalized : fallback;
};

const normalizeEntities = (entities = {}) => {
    const productIds = Array.isArray(entities?.productIds)
        ? entities.productIds.map((entry) => safeString(entry)).filter(Boolean).slice(0, 8)
        : [];

    return {
        query: safeString(entities?.query || ''),
        productId: safeString(entities?.productId || ''),
        productIds,
        quantity: Math.max(0, Number(entities?.quantity) || 0),
        priceMin: Math.max(0, Number(entities?.priceMin) || 0),
        priceMax: Math.max(0, Number(entities?.priceMax) || 0),
        category: safeString(entities?.category || ''),
        page: safeString(entities?.page || ''),
        orderId: safeString(entities?.orderId || ''),
        supportCategory: safeString(entities?.supportCategory || ''),
        operation: safeString(entities?.operation || ''),
        compareTerms: Array.isArray(entities?.compareTerms)
            ? entities.compareTerms.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4)
            : [],
    };
};

const normalizeAction = (action = {}) => {
    const type = normalizeActionType(action?.type);
    if (!type) return null;

    return {
        type,
        productId: safeString(action?.productId || ''),
        quantity: Math.max(0, Number(action?.quantity) || 0),
        query: safeString(action?.query || ''),
        filters: action?.filters && typeof action.filters === 'object' ? {
            category: safeString(action.filters.category || ''),
            priceMin: Math.max(0, Number(action.filters.priceMin) || 0),
            priceMax: Math.max(0, Number(action.filters.priceMax) || 0),
        } : {},
        page: safeString(action?.page || ''),
        params: action?.params && typeof action.params === 'object' ? action.params : {},
        orderId: safeString(action?.orderId || ''),
        prefill: action?.prefill && typeof action.prefill === 'object' ? action.prefill : null,
        requiresConfirmation: Boolean(action?.requiresConfirmation),
        reason: safeString(action?.reason || ''),
    };
};

const normalizeActions = (actions = []) => (
    (Array.isArray(actions) ? actions : [])
        .map((entry) => normalizeAction(entry))
        .filter(Boolean)
        .slice(0, 6)
);

const normalizeCitation = (citation = {}) => ({
    id: safeString(citation?.id || ''),
    label: safeString(citation?.label || citation?.path || citation?.title || ''),
    type: safeString(citation?.type || citation?.sourceType || 'code').toLowerCase() || 'code',
    path: safeString(citation?.path || ''),
    title: safeString(citation?.title || ''),
    excerpt: safeString(citation?.excerpt || ''),
    startLine: Math.max(0, Number(citation?.startLine) || 0),
    endLine: Math.max(0, Number(citation?.endLine) || 0),
    score: clamp(citation?.score, 0, 1),
    metadata: citation?.metadata && typeof citation.metadata === 'object' ? citation.metadata : {},
});

const normalizeCitations = (citations = []) => (
    (Array.isArray(citations) ? citations : [])
        .map((entry) => normalizeCitation(entry))
        .filter((entry) => entry.label || entry.path || entry.excerpt)
        .slice(0, 12)
);

const normalizeToolRun = (toolRun = {}) => ({
    id: safeString(toolRun?.id || ''),
    toolName: safeString(toolRun?.toolName || toolRun?.name || ''),
    status: safeString(toolRun?.status || 'completed') || 'completed',
    startedAt: safeString(toolRun?.startedAt || ''),
    endedAt: safeString(toolRun?.endedAt || ''),
    latencyMs: Math.max(0, Number(toolRun?.latencyMs) || 0),
    summary: safeString(toolRun?.summary || ''),
    inputPreview: toolRun?.inputPreview && typeof toolRun.inputPreview === 'object' ? toolRun.inputPreview : {},
    outputPreview: toolRun?.outputPreview && typeof toolRun.outputPreview === 'object' ? toolRun.outputPreview : {},
});

const normalizeToolRuns = (toolRuns = []) => (
    (Array.isArray(toolRuns) ? toolRuns : [])
        .map((entry) => normalizeToolRun(entry))
        .filter((entry) => entry.toolName)
        .slice(0, 12)
);

const normalizeVerification = (verification = {}) => ({
    label: normalizeVerificationLabel(verification?.label || verification?.mode || verification?.status || 'cannot_verify'),
    confidence: clamp(verification?.confidence, 0, 1),
    summary: safeString(verification?.summary || ''),
    validatedAt: safeString(verification?.validatedAt || ''),
    evidenceCount: Math.max(0, Number(verification?.evidenceCount) || 0),
});

const normalizePolicy = (policy = {}) => (
    policy && typeof policy === 'object'
        ? {
            actionType: safeString(policy?.actionType || ''),
            risk: safeString(policy?.risk || ''),
            decision: safeString(policy?.decision || ''),
            reason: safeString(policy?.reason || ''),
        }
        : null
);

const buildConfirmationToken = (action = {}) => crypto
    .createHash('sha256')
    .update(JSON.stringify({
        type: safeString(action?.type || ''),
        productId: safeString(action?.productId || ''),
        query: safeString(action?.query || ''),
        page: safeString(action?.page || ''),
        orderId: safeString(action?.orderId || ''),
        quantity: Math.max(0, Number(action?.quantity) || 0),
    }))
    .digest('hex')
    .slice(0, 16);

const buildAssistantTurn = ({
    intent = 'general_knowledge',
    entities = {},
    confidence = 0,
    decision = 'respond',
    response = '',
    actions = [],
    ui = {},
    contextPatch = {},
    followUps = [],
    safetyFlags = [],
    citations = [],
    toolRuns = [],
    verification = {},
    policy = null,
    sessionMemory = null,
    answerMode = 'commerce',
} = {}) => ({
    intent: normalizeIntent(intent),
    entities: normalizeEntities(entities),
    confidence: clamp(confidence, 0, 1),
    decision: normalizeDecision(decision),
    response: safeString(response),
    answerMode: normalizeAnswerMode(answerMode),
    actions: normalizeActions(actions),
    ui: {
        surface: normalizeUiSurface(ui?.surface || 'plain_answer'),
        title: safeString(ui?.title || ''),
        products: Array.isArray(ui?.products) ? ui.products : [],
        product: ui?.product && typeof ui.product === 'object' ? ui.product : null,
        cartSummary: ui?.cartSummary && typeof ui.cartSummary === 'object' ? ui.cartSummary : null,
        confirmation: ui?.confirmation && typeof ui.confirmation === 'object'
            ? {
                token: safeString(ui.confirmation.token || ''),
                message: safeString(ui.confirmation.message || ''),
                action: normalizeAction(ui.confirmation.action || {}) || null,
            }
            : null,
        navigation: ui?.navigation && typeof ui.navigation === 'object'
            ? {
                page: safeString(ui.navigation.page || ''),
                path: safeString(ui.navigation.path || ''),
                params: ui.navigation.params && typeof ui.navigation.params === 'object' ? ui.navigation.params : {},
            }
            : null,
        support: ui?.support && typeof ui.support === 'object'
            ? {
                orderId: safeString(ui.support.orderId || ''),
                prefill: ui.support.prefill && typeof ui.support.prefill === 'object' ? ui.support.prefill : null,
            }
            : null,
    },
    contextPatch: contextPatch && typeof contextPatch === 'object' ? contextPatch : {},
    followUps: Array.isArray(followUps)
        ? followUps.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4)
        : [],
    safetyFlags: Array.isArray(safetyFlags)
        ? safetyFlags.map((entry) => safeString(entry)).filter(Boolean).slice(0, 6)
        : [],
    citations: normalizeCitations(citations),
    toolRuns: normalizeToolRuns(toolRuns),
    verification: normalizeVerification(verification),
    policy: normalizePolicy(policy),
    sessionMemory: sessionMemory && typeof sessionMemory === 'object' ? sessionMemory : null,
});

module.exports = {
    ASSISTANT_ACTION_TYPES,
    ANSWER_MODES,
    DECISIONS,
    INTENTS,
    UI_SURFACES,
    VERIFICATION_LABELS,
    buildAssistantTurn,
    buildConfirmationToken,
    normalizeAction,
    normalizeActions,
    normalizeAnswerMode,
    normalizeCitation,
    normalizeCitations,
    normalizeDecision,
    normalizeEntities,
    normalizeIntent,
    normalizePolicy,
    normalizeToolRun,
    normalizeToolRuns,
    normalizeVerification,
    normalizeVerificationLabel,
    safeString,
};
