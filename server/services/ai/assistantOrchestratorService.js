const { getProductByIdentifier } = require('../catalogService');
const {
    buildGroundedCatalogContext,
    buildCommerceFallbackResponse,
} = require('../assistantCommerceService');
const { buildSmartBundle, computeDealDna } = require('../commerceIntelligenceService');
const { buildProductRecommendations } = require('../productRecommendationService');
const {
    createVoiceSessionConfig,
    generateStructuredResponse,
    getCapabilitySnapshot,
    synthesizeSpeech,
} = require('./providerRegistry');
const { interpretVoiceCommand } = require('./voiceCommandService');
const { runMultimodalVisualSearch } = require('./multimodalVisualSearchService');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

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

const summarizeProduct = (product = {}) => [
    safeString(product.title || 'Untitled product'),
    safeString(product.brand),
    safeString(product.category),
    Number(product.price || 0) > 0 ? `INR ${Number(product.price).toLocaleString('en-IN')}` : '',
    Number(product.rating || 0) > 0 ? `${Number(product.rating).toFixed(1)}/5` : '',
    safeString(product.deliveryTime),
].filter(Boolean).join(' | ');

const summarizeProducts = (products = []) => (
    (Array.isArray(products) ? products : [])
        .slice(0, 6)
        .map((product, index) => `P${index + 1}: ${summarizeProduct(product)}`)
        .join('\n')
);

const buildFollowUps = (mode, products = []) => {
    if (mode === 'compare') return ['Show cheaper alternative', 'Explain the tradeoff', 'Open best product'];
    if (mode === 'bundle') return ['Tighten budget', 'Swap one item', 'Open bundle page'];
    if (mode === 'voice') return ['Open cart', 'Search deals', 'Show mobiles'];
    if ((products || []).length > 0) return ['Compare top results', 'Show cheaper picks', 'Open visual search'];
    return ['Best deals today', 'Compare products', 'Build a smart bundle'];
};

const buildLocalCompareSummary = (products = [], mode = 'balanced') => {
    if (!Array.isArray(products) || products.length === 0) {
        return {
            answer: 'No products are available to compare yet.',
            winner: null,
        };
    }

    const scored = products.map((product) => {
        const price = Number(product.price || 0);
        const rating = Number(product.rating || 0);
        const reviews = Number(product.ratingCount || 0);
        const discount = Number(product.discountPercentage || 0);
        const dealDna = computeDealDna(product);
        let score = 0;

        if (mode === 'budget') {
            score = (100000 / Math.max(price, 1)) + (discount * 2.2) + (rating * 25) + (reviews / 200);
        } else if (mode === 'premium') {
            score = (rating * 34) + (reviews / 100) + (dealDna.score * 0.5) + (discount * 0.8);
        } else if (mode === 'speed') {
            const deliveryScore = /1|2/.test(safeString(product.deliveryTime)) ? 90 : 55;
            score = (deliveryScore * 0.45) + (rating * 20) + (dealDna.score * 0.35);
        } else {
            score = (rating * 28) + (dealDna.score * 0.45) + (discount * 1.4) + (reviews / 180);
        }

        return {
            product,
            score,
            dealDna,
        };
    }).sort((left, right) => right.score - left.score);

    const winner = scored[0];
    const runnerUp = scored[1];
    const priceGap = runnerUp
        ? Math.abs(Number(winner.product.price || 0) - Number(runnerUp.product.price || 0))
        : 0;

    return {
        winner,
        scored,
        answer: runnerUp
            ? `${winner.product.title} is the strongest ${mode} pick right now. It leads on value signals and beats ${runnerUp.product.title} with a cleaner overall score. The current price gap is INR ${priceGap.toLocaleString('en-IN')}.`
            : `${winner.product.title} is currently the only strong grounded comparison candidate.`,
    };
};

const buildLocalBundleSummary = (bundle = null) => {
    if (!bundle || !Array.isArray(bundle.items) || bundle.items.length === 0) {
        return 'No grounded bundle could be assembled yet.';
    }

    return `${bundle.bundleName || 'Smart bundle'} includes ${bundle.items.length} items for INR ${Number(bundle.totalPrice || 0).toLocaleString('en-IN')}. Estimated savings are INR ${Number(bundle.savings || 0).toLocaleString('en-IN')} with ${Number(bundle.budgetUtilization || 0)}% budget utilization.`;
};

const buildSystemPrompt = (assistantMode) => [
    'You are Aura AI, a multimodal commerce copilot for an Indian ecommerce platform.',
    'Return strict JSON only.',
    'Schema:',
    '{"answer":"string","followUps":["string"],"actions":[{"type":"string","path":"string","query":"string","productId":"string","reason":"string"}],"safetyFlags":["string"]}',
    'Rules:',
    '- Stay grounded in the provided catalog and computed context.',
    '- Do not invent products, prices, stock, or user account state.',
    '- Keep the answer concise and practical.',
    `- Current assistant mode: ${safeString(assistantMode || 'chat')}.`,
].join('\n');

const buildUserPrompt = ({
    message,
    assistantMode,
    grounding,
    conversationHistory,
}) => [
    `User message: ${safeString(message)}`,
    `Assistant mode: ${safeString(assistantMode || 'chat')}`,
    conversationHistory.length > 0
        ? `Conversation history:\n${conversationHistory.map((entry) => `${entry.role}: ${entry.content}`).join('\n')}`
        : 'Conversation history: none',
    `Grounding summary:\n${JSON.stringify(grounding, null, 2)}`,
    'Respond using the JSON schema only.',
].join('\n\n');

const buildLegacyShape = ({
    answer,
    followUps,
    products,
    provider,
    grounding,
    isAI,
    mode,
}) => ({
    text: answer,
    suggestions: followUps,
    products,
    actionType: safeString(grounding?.actionType || assistantModeToLegacyAction(mode)),
    isAI,
    provider,
    mode,
});

const assistantModeToLegacyAction = (assistantMode = '') => {
    if (assistantMode === 'voice') return 'assistant';
    if (assistantMode === 'compare') return 'compare';
    if (assistantMode === 'bundle') return 'assistant';
    return 'assistant';
};

const buildGrounding = async ({
    user = null,
    message = '',
    assistantMode = 'chat',
    conversationHistory = [],
    context = {},
    images = [],
}) => {
    const trimmedMessage = safeString(message).slice(0, 900);

    if (assistantMode === 'voice') {
        const voice = interpretVoiceCommand(trimmedMessage);
        return {
            mode: 'voice',
            answerHint: voice.answer,
            actions: voice.actions || [],
            followUps: voice.followUps || [],
            products: [],
            actionType: 'assistant',
        };
    }

    if (assistantMode === 'compare') {
        const productIds = Array.isArray(context?.productIds) ? context.productIds.slice(0, 4) : [];
        const products = (await Promise.all(productIds.map((id) => getProductByIdentifier(id).catch(() => null)))).filter(Boolean);
        const comparison = buildLocalCompareSummary(products, safeString(context?.compareMode || 'balanced').toLowerCase());
        return {
            mode: 'compare',
            products,
            comparison: {
                answer: comparison.answer,
                winnerProductId: safeString(comparison?.winner?.product?.id || comparison?.winner?.product?._id || ''),
                compareMode: safeString(context?.compareMode || 'balanced'),
            },
            actionType: 'compare',
        };
    }

    if (assistantMode === 'bundle') {
        const inlineBundle = context?.bundle && Array.isArray(context.bundle.items)
            ? context.bundle
            : await buildSmartBundle({
                theme: safeString(context?.theme || 'smart essentials'),
                budget: Number(context?.budget || 25000),
                maxItems: Number(context?.maxItems || 6),
            }).catch(() => null);
        return {
            mode: 'bundle',
            products: inlineBundle?.items || [],
            bundle: inlineBundle,
            actionType: 'assistant',
        };
    }

    let visualGrounding = null;
    if (images.length > 0 || safeString(context?.imageUrl) || safeString(context?.imageDataUrl)) {
        visualGrounding = await runMultimodalVisualSearch({
            imageUrl: safeString(context?.imageUrl || images[0]?.url || ''),
            imageDataUrl: safeString(context?.imageDataUrl || images[0]?.dataUrl || ''),
            fileName: safeString(context?.fileName || images[0]?.fileName || ''),
            hints: safeString(context?.hints || ''),
            imageMeta: context?.imageMeta || null,
            message: trimmedMessage,
        }).catch(() => null);
    }

    const catalogGrounding = await buildGroundedCatalogContext({
        message: trimmedMessage,
        conversationHistory,
    });

    const recommendationSignals = context?.recommendationSignals && typeof context.recommendationSignals === 'object'
        ? context.recommendationSignals
        : null;
    const recommendations = recommendationSignals
        ? await buildProductRecommendations({
            userId: user?._id || null,
            input: recommendationSignals,
        }).catch(() => null)
        : null;

    return {
        mode: 'chat',
        actionType: catalogGrounding.actionType || 'assistant',
        commerceIntent: Boolean(catalogGrounding.commerceIntent),
        products: visualGrounding?.matches?.length > 0
            ? visualGrounding.matches
            : (catalogGrounding.products || []),
        visual: visualGrounding ? {
            querySignals: visualGrounding.querySignals,
            total: visualGrounding.total,
        } : null,
        catalog: {
            commerceIntent: Boolean(catalogGrounding.commerceIntent),
            category: safeString(catalogGrounding.category || ''),
            maxPrice: Number(catalogGrounding.maxPrice || 0),
        },
        recommendations: recommendations ? {
            title: safeString(recommendations.title || ''),
            sourceLabels: recommendations.sourceLabels || [],
            total: Array.isArray(recommendations.products) ? recommendations.products.length : 0,
        } : null,
    };
};

const buildLocalResponse = async ({
    message,
    assistantMode,
    grounding,
}) => {
    if (assistantMode === 'voice') {
        return {
            answer: safeString(grounding.answerHint || 'Voice command processed.'),
            followUps: grounding.followUps || buildFollowUps('voice'),
            actions: grounding.actions || [],
            products: [],
            safetyFlags: [],
        };
    }

    if (assistantMode === 'compare') {
        return {
            answer: safeString(grounding?.comparison?.answer || 'Comparison is ready.'),
            followUps: buildFollowUps('compare', grounding.products),
            actions: grounding?.comparison?.winnerProductId
                ? [{ type: 'open_product', productId: grounding.comparison.winnerProductId, reason: 'top_compared_match' }]
                : [],
            products: grounding.products || [],
            safetyFlags: [],
        };
    }

    if (assistantMode === 'bundle') {
        return {
            answer: buildLocalBundleSummary(grounding.bundle),
            followUps: buildFollowUps('bundle', grounding.products),
            actions: grounding?.bundle
                ? [{ type: 'navigate', path: `/bundles?theme=${encodeURIComponent(safeString(grounding.bundle.theme || 'smart essentials'))}&budget=${encodeURIComponent(String(grounding.bundle.budget || 25000))}`, reason: 'bundle_review' }]
                : [],
            products: grounding.products || [],
            safetyFlags: [],
        };
    }

    if (grounding?.catalog?.commerceIntent) {
        const fallback = await buildCommerceFallbackResponse(message);
        if (fallback) {
            return {
                answer: fallback.text,
                followUps: buildFollowUps('chat', fallback.products),
                actions: [],
                products: fallback.products || grounding.products || [],
                safetyFlags: [],
            };
        }
    }

    if (grounding?.visual?.total > 0) {
        return {
            answer: `I found ${grounding.visual.total} image-grounded catalog matches. Use the top results to compare price, trust signals, and authenticity hints.`,
            followUps: buildFollowUps('chat', grounding.products),
            actions: [],
            products: grounding.products || [],
            safetyFlags: [],
        };
    }

    return {
        answer: 'I can help with shopping, comparisons, bundles, and voice-driven navigation. Ask for a product, budget, or use case.',
        followUps: buildFollowUps('chat', grounding.products),
        actions: [],
        products: grounding.products || [],
        safetyFlags: [],
    };
};

const normalizeProviderPayload = (payload = {}, fallback = {}) => ({
    answer: safeString(payload.answer || fallback.answer),
    followUps: Array.isArray(payload.followUps)
        ? payload.followUps.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4)
        : (fallback.followUps || []),
    actions: Array.isArray(payload.actions)
        ? payload.actions
            .map((entry) => ({
                type: safeString(entry?.type || ''),
                path: safeString(entry?.path || ''),
                query: safeString(entry?.query || ''),
                productId: safeString(entry?.productId || ''),
                reason: safeString(entry?.reason || ''),
            }))
            .filter((entry) => entry.type)
            .slice(0, 4)
        : (fallback.actions || []),
    safetyFlags: Array.isArray(payload.safetyFlags)
        ? payload.safetyFlags.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4)
        : (fallback.safetyFlags || []),
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
    const grounding = await buildGrounding({
        user,
        message,
        assistantMode,
        conversationHistory: normalizedHistory,
        context,
        images,
    });

    const localFallback = await buildLocalResponse({
        message,
        assistantMode,
        grounding,
    });

    const providerResponse = assistantMode === 'voice' && Array.isArray(grounding.actions) && grounding.actions.length > 0
        ? { payload: null, provider: 'local', model: 'local' }
        : await generateStructuredResponse({
            systemPrompt: buildSystemPrompt(assistantMode),
            userPrompt: buildUserPrompt({
                message,
                assistantMode,
                grounding: {
                    ...grounding,
                    productSummary: summarizeProducts(grounding.products || []),
                },
                conversationHistory: normalizedHistory,
            }),
            images,
            temperature: 0.2,
            maxTokens: 700,
            preferVision: images.length > 0,
        });

    const normalizedPayload = normalizeProviderPayload(providerResponse.payload, localFallback);
    const answer = normalizedPayload.answer || localFallback.answer;
    const followUps = normalizedPayload.followUps.length > 0 ? normalizedPayload.followUps : localFallback.followUps;
    const actions = normalizedPayload.actions.length > 0 ? normalizedPayload.actions : localFallback.actions;
    const products = Array.isArray(localFallback.products) ? localFallback.products : (grounding.products || []);
    const safetyFlags = normalizedPayload.safetyFlags;
    const provider = safeString(providerResponse.provider || 'local');
    const capabilitySnapshot = getCapabilitySnapshot();

    return {
        answer,
        products,
        actions,
        followUps,
        grounding: {
            mode: assistantMode,
            actionType: safeString(grounding.actionType || 'assistant'),
            commerceIntent: Boolean(grounding?.catalog?.commerceIntent),
            visual: grounding.visual || null,
            compare: grounding.comparison || null,
            bundle: grounding.bundle
                ? {
                    bundleName: safeString(grounding.bundle.bundleName || ''),
                    totalPrice: Number(grounding.bundle.totalPrice || 0),
                    savings: Number(grounding.bundle.savings || 0),
                    itemCount: Array.isArray(grounding.bundle.items) ? grounding.bundle.items.length : 0,
                }
                : null,
            recommendations: grounding.recommendations || null,
        },
        provider,
        providerCapabilities: capabilitySnapshot,
        latencyMs: Date.now() - startedAt,
        safetyFlags,
        legacy: buildLegacyShape({
            answer,
            followUps,
            products,
            provider,
            grounding,
            isAI: provider !== 'local',
            mode: assistantMode,
        }),
    };
};

module.exports = {
    createVoiceSessionConfig,
    processAssistantTurn,
    synthesizeVoiceReply: synthesizeSpeech,
};
