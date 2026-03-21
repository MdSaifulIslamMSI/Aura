const {
    createVoiceSessionConfig,
    getCapabilitySnapshot,
    synthesizeSpeech,
} = require('./providerRegistry');
const {
    classifyAssistantTurn,
    composeAssistantResponse,
    enrichAssistantContext,
    planAssistantTurn,
} = require('./assistantDecisionEngine');
const {
    buildAssistantTurn,
    normalizeActions,
    safeString,
} = require('./assistantContract');

const normalizeHistory = (conversationHistory = []) => (
    Array.isArray(conversationHistory)
        ? conversationHistory
            .slice(-8)
            .map((entry) => ({
                role: safeString(entry?.role || 'user'),
                content: safeString(entry?.content || ''),
            }))
            .filter((entry) => entry.content)
        : []
);

const assistantModeToLegacyAction = (assistantMode = '') => {
    if (assistantMode === 'compare') return 'compare';
    return 'assistant';
};

const turnToProducts = (assistantTurn = {}, enriched = {}) => {
    if (Array.isArray(assistantTurn?.ui?.products) && assistantTurn.ui.products.length > 0) {
        return assistantTurn.ui.products;
    }

    if (assistantTurn?.ui?.product && typeof assistantTurn.ui.product === 'object') {
        return [assistantTurn.ui.product];
    }

    if (Array.isArray(enriched?.visibleProducts) && enriched.visibleProducts.length > 0) {
        return enriched.visibleProducts;
    }

    if (enriched?.selectedProduct && typeof enriched.selectedProduct === 'object') {
        return [enriched.selectedProduct];
    }

    return [];
};

const mapTurnActionToLegacy = (action = {}) => {
    const type = safeString(action?.type || '');
    if (!type) return null;

    if (type === 'search_products') {
        return {
            type: 'search',
            query: safeString(action.query || ''),
            reason: safeString(action.reason || ''),
        };
    }

    if (type === 'select_product') {
        return {
            type: 'open_product',
            productId: safeString(action.productId || ''),
            reason: safeString(action.reason || ''),
        };
    }

    if (type === 'navigate_to') {
        const page = safeString(action.page || '');
        const path = page === 'support'
            ? '/profile?tab=support'
            : page
                ? `/${page.replace(/_/g, '-')}`.replace('//', '/')
                : '/';
        return {
            type: 'navigate',
            path,
            reason: safeString(action.reason || ''),
        };
    }

    if (type === 'go_to_checkout') {
        return {
            type: 'navigate',
            path: '/checkout',
            reason: safeString(action.reason || ''),
        };
    }

    if (type === 'track_order') {
        return {
            type: 'navigate',
            path: `/orders?focus=${encodeURIComponent(safeString(action.orderId || ''))}`,
            reason: safeString(action.reason || ''),
        };
    }

    if (type === 'open_support') {
        const params = new URLSearchParams();
        params.set('tab', 'support');
        params.set('compose', '1');

        if (safeString(action.orderId)) params.set('orderId', safeString(action.orderId));
        if (safeString(action.prefill?.category)) params.set('category', safeString(action.prefill.category));
        if (safeString(action.prefill?.subject)) params.set('subject', safeString(action.prefill.subject));
        if (safeString(action.prefill?.body)) params.set('intent', safeString(action.prefill.body));

        return {
            type: 'navigate',
            path: `/profile?${params.toString()}`,
            reason: safeString(action.reason || ''),
        };
    }

    return null;
};

const mapLegacyActions = (actions = []) => (
    normalizeActions(actions)
        .map((entry) => mapTurnActionToLegacy(entry))
        .filter(Boolean)
        .slice(0, 4)
);

const buildLegacyShape = ({
    answer,
    followUps,
    products,
    provider,
    grounding,
    mode,
}) => ({
    text: answer,
    suggestions: followUps,
    products,
    actionType: safeString(grounding?.actionType || assistantModeToLegacyAction(mode)),
    isAI: provider !== 'local',
    provider,
    mode,
});

const processAssistantTurn = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    context = {},
    images = [],
}) => {
    const startedAt = Date.now();
    const normalizedHistory = normalizeHistory(conversationHistory);

    const classification = await classifyAssistantTurn({
        message,
        assistantMode,
        context,
        images,
    });

    const enriched = await enrichAssistantContext({
        user,
        message,
        conversationHistory: normalizedHistory,
        assistantMode,
        context,
        classification,
        images,
    });

    const plannedTurn = planAssistantTurn({
        message,
        classification,
        enriched,
    });

    const composed = await composeAssistantResponse({
        message,
        turn: plannedTurn,
        enriched,
        images,
    });

    const assistantTurn = buildAssistantTurn({
        ...plannedTurn,
        response: safeString(composed.response || plannedTurn.response),
        followUps: composed.followUps || plannedTurn.followUps,
    });

    const products = turnToProducts(assistantTurn, enriched);
    const followUps = Array.isArray(assistantTurn.followUps) ? assistantTurn.followUps : [];
    const answer = safeString(assistantTurn.response || '');
    const provider = safeString(
        composed.provider !== 'local'
            ? composed.provider
            : classification?.provider || 'local'
    );

    const grounding = {
        mode: assistantMode,
        actionType: assistantModeToLegacyAction(assistantMode),
        commerceIntent: ['product_search', 'product_selection'].includes(assistantTurn.intent),
        catalog: enriched?.groundedCatalog
            ? {
                category: safeString(enriched.groundedCatalog.category || ''),
                maxPrice: Number(enriched.groundedCatalog.maxPrice || 0),
                productCount: Array.isArray(enriched.groundedCatalog.products) ? enriched.groundedCatalog.products.length : 0,
            }
            : null,
        assistantTurn: {
            intent: assistantTurn.intent,
            confidence: assistantTurn.confidence,
            decision: assistantTurn.decision,
            surface: safeString(assistantTurn?.ui?.surface || ''),
        },
        contextPatch: assistantTurn.contextPatch || {},
        imagesIncluded: Array.isArray(images) && images.length > 0,
    };

    return {
        answer,
        products,
        actions: mapLegacyActions(assistantTurn.actions),
        followUps,
        assistantTurn,
        grounding,
        provider,
        providerCapabilities: getCapabilitySnapshot(),
        latencyMs: Date.now() - startedAt,
        safetyFlags: Array.isArray(assistantTurn.safetyFlags) ? assistantTurn.safetyFlags : [],
        legacy: buildLegacyShape({
            answer,
            followUps,
            products,
            provider,
            grounding,
            mode: assistantMode,
        }),
    };
};

module.exports = {
    createVoiceSessionConfig,
    processAssistantTurn,
    synthesizeVoiceReply: synthesizeSpeech,
};
