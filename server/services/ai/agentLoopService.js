/**
 * Iterative agent tool loop for commerce reasoning.
 *
 * Instead of one-shot route-and-respond, the model may call read-only
 * catalog tools across iterations (search → inspect → compare), with every
 * call validated against the assistant tool registry before execution.
 * Mutations are never executable here: any state-changing proposal is
 * returned as `proposedAction` for the confirmation-envelope path.
 * Final product ids are intersected with actually-observed ids, so the
 * model cannot invent products even mid-loop.
 */

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const AGENT_MAX_ITERATIONS = 4;
const AGENT_LOOP_TOOLS = Object.freeze([
    'search_products',
    'get_product_details',
    'check_inventory',
    'get_price',
    'compare_products',
]);

const AGENT_RESPONSE_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        thought: { type: 'string' },
        tool_calls: {
            type: 'array',
            items: { type: 'object' },
        },
        answer: { type: 'string' },
        productIds: {
            type: 'array',
            items: { type: 'string' },
        },
        followUps: {
            type: 'array',
            items: { type: 'string' },
        },
        proposedAction: { type: 'object' },
    },
});

const throwIfAborted = (abortSignal = null) => {
    if (abortSignal?.aborted) {
        const error = new Error('assistant_request_aborted');
        error.name = 'AssistantAbortError';
        error.code = 'ASSISTANT_REQUEST_ABORTED';
        throw error;
    }
};

const lazyDeps = () => {
    const { generateStructuredJson } = require('./modelGatewayService');
    const { validateAssistantAction } = require('./assistantToolRegistry');
    const { searchProductVectorIndex } = require('./localProductVectorIndexService');
    const Product = require('../../models/Product');
    return { generateStructuredJson, validateAssistantAction, searchProductVectorIndex, Product };
};

const PRODUCT_CARD_SELECT = 'id title displayTitle brand category price originalPrice discountPercentage image images stock rating ratingCount deliveryTime warranty description highlights specifications';

const summarizeProduct = (product = {}) => ({
    id: safeString(product?.id || ''),
    title: safeString(product?.displayTitle || product?.title || ''),
    brand: safeString(product?.brand || ''),
    category: safeString(product?.category || ''),
    price: Number(product?.price || 0),
    stock: Number(product?.stock || 0),
    rating: Number(product?.rating || 0),
    ratingCount: Number(product?.ratingCount || 0),
});

const buildAgentSystemPrompt = ({ filters = {}, visualContext = '' } = {}) => ([
    'You are Aura, a shopping assistant that reasons with tools.',
    'Rules:',
    '1. NEVER invent products, prices, stock, or ratings. Use only tool observations.',
    '2. Call one or more read-only tools per turn: search_products, get_product_details, check_inventory, get_price, compare_products.',
    '3. NEVER emit add_to_cart, remove_from_cart, cancel_order, create_return_request, apply_coupon, or go_to_checkout as tool_calls. To propose one, use proposedAction instead.',
    '4. When observations answer the question, respond with answer + productIds (ids seen in observations only) + up to 3 followUps. Then stop calling tools.',
    '5. If observations are empty, say so honestly and suggest a next step. Do not guess.',
    `Active catalog filters: ${JSON.stringify(filters || {})}.`,
    visualContext ? `Visual evidence (do not re-describe beyond using it): ${visualContext}.` : '',
].filter(Boolean).join('\n'));

const renderHistory = ({ message = '', turns = [] } = {}) => ([
    `Shopper request: ${safeString(message) || '(empty)'}`,
    ...turns.map((turn, index) => [
        `--- Iteration ${index + 1} ---`,
        turn.thought ? `Thought: ${safeString(turn.thought).slice(0, 500)}` : '',
        (turn.observations || []).map((observation) => `Observation: ${safeString(observation).slice(0, 1200)}`).join('\n'),
    ].filter(Boolean).join('\n')),
].join('\n\n'));

const executeLoopTool = async ({ toolCall = {}, deps }) => {
    const type = safeString(toolCall?.type || '');
    if (!AGENT_LOOP_TOOLS.includes(type)) {
        return { ok: false, summary: `Tool ${type || 'unknown'} is not permitted in the agent loop.`, products: [] };
    }
    const validation = deps.validateAssistantAction({ ...toolCall, type });
    if (!validation.ok) {
        return { ok: false, summary: `Tool call rejected (${validation.reason}).`, products: [] };
    }

    if (type === 'search_products') {
        const query = safeString(toolCall.query);
        if (!query) return { ok: false, summary: 'search_products needs a query.', products: [] };
        const retrieval = await deps.searchProductVectorIndex(query, {
            limit: 5,
            filters: toolCall.filters && typeof toolCall.filters === 'object' ? toolCall.filters : {},
        });
        const products = (retrieval.results || []).map((entry) => summarizeProduct(entry.product || entry)).filter((entry) => entry.id);
        return {
            ok: true,
            summary: products.length > 0
                ? `Found ${products.length}: ${products.map((entry) => `${entry.id}|${entry.title}|Rs.${entry.price}|stock:${entry.stock}|rating:${entry.rating}`).join('; ')}`
                : 'No catalog matches for that query.',
            products,
        };
    }

    if (type === 'compare_products') {
        const ids = [...new Set((Array.isArray(toolCall.productIds) ? toolCall.productIds : []).map((entry) => safeString(entry)).filter(Boolean))].slice(0, 4);
        if (ids.length < 2) return { ok: false, summary: 'compare_products needs 2-4 productIds.', products: [] };
        const docs = await deps.Product.find({ id: { $in: ids.map(Number).filter((entry) => Number.isInteger(entry)) }, isPublished: true })
            .select(PRODUCT_CARD_SELECT).lean();
        const products = docs.map(summarizeProduct).filter((entry) => entry.id);
        return {
            ok: true,
            summary: products.map((entry) => `${entry.id}|${entry.title}|Rs.${entry.price}|stock:${entry.stock}|rating:${entry.rating}(${entry.ratingCount})`).join('; ') || 'None of those products exist.',
            products,
        };
    }

    const productId = safeString(toolCall.productId || '');
    const numericId = Number(productId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
        return { ok: false, summary: 'A positive numeric productId is required.', products: [] };
    }
    const doc = await deps.Product.findOne({ id: numericId, isPublished: true }).select(PRODUCT_CARD_SELECT).lean();
    if (!doc) return { ok: true, summary: `Product ${productId} does not exist.`, products: [] };
    const product = summarizeProduct(doc);
    if (type === 'check_inventory') {
        return { ok: true, summary: `Product ${product.id} (${product.title}) stock: ${product.stock}.`, products: [product] };
    }
    if (type === 'get_price') {
        return { ok: true, summary: `Product ${product.id} (${product.title}) price: Rs.${product.price}, stock: ${product.stock}.`, products: [product] };
    }
    return { ok: true, summary: `Product ${product.id}: ${product.title} by ${product.brand}, Rs.${product.price}, stock ${product.stock}, rating ${product.rating}.`, products: [product] };
};

/**
 * @returns {{ answer, productIds, followUps, toolRuns, iterations, observedProducts, proposedAction, provider, providerModel }}
 */
const runAgentLoop = async ({
    message = '',
    filters = {},
    assistantSession = {},
    abortSignal = null,
    onEvent = null,
    visualContext = '',
    deps = null,
} = {}) => {
    const resolved = deps || lazyDeps();
    const emit = (event) => {
        try {
            if (typeof onEvent === 'function') onEvent(event);
        } catch { /* progress must never break reasoning */ }
    };
    const turns = [];
    const observedById = new Map();
    const toolRuns = [];
    let provider = '';
    let providerModel = '';
    let proposedAction = null;

    for (let iteration = 1; iteration <= AGENT_MAX_ITERATIONS; iteration += 1) {
        throwIfAborted(abortSignal);
        const startedAt = Date.now();
        const response = await resolved.generateStructuredJson({
            systemPrompt: buildAgentSystemPrompt({ filters, visualContext }),
            prompt: renderHistory({ message, turns }),
            route: 'ECOMMERCE',
            temperature: 0.2,
            responseJsonSchema: AGENT_RESPONSE_SCHEMA,
            abortSignal,
        });
        throwIfAborted(abortSignal);
        provider = safeString(response?.provider || provider);
        providerModel = safeString(response?.providerModel || providerModel);
        const data = response?.data && typeof response.data === 'object' ? response.data : {};
        const toolCalls = Array.isArray(data.tool_calls) ? data.tool_calls.slice(0, 3) : [];
        const observations = [];

        for (const toolCall of toolCalls) {
            throwIfAborted(abortSignal);
            const toolType = safeString(toolCall?.type || 'unknown');
            emit({ type: 'tool_start', toolName: toolType, iteration });
            const outcome = await executeLoopTool({ toolCall, deps: resolved });
            const latencyMs = Date.now() - startedAt;
            emit({ type: 'tool_end', toolName: toolType, iteration, status: outcome.ok ? 'completed' : 'failed', latencyMs });
            toolRuns.push({
                id: `agent-${iteration}-${toolRuns.length + 1}`,
                toolName: toolType,
                status: outcome.ok ? 'completed' : 'failed',
                latencyMs,
                summary: safeString(outcome.summary).slice(0, 280),
                inputPreview: { iteration },
                outputPreview: { products: outcome.products.map((entry) => entry.id) },
            });
            observations.push(`${toolType}: ${outcome.summary}`);
            outcome.products.forEach((entry) => {
                if (entry.id && !observedById.has(entry.id)) observedById.set(entry.id, entry);
            });
        }

        turns.push({ thought: safeString(data.thought || ''), observations });
        if (data.proposedAction && typeof data.proposedAction === 'object') {
            proposedAction = data.proposedAction;
        }

        const answer = safeString(data.answer || '');
        if (answer && toolCalls.length === 0) {
            const allowed = new Set(observedById.keys());
            const productIds = [...new Set((Array.isArray(data.productIds) ? data.productIds : []).map((entry) => safeString(entry)).filter(Boolean))]
                .filter((entry) => allowed.has(entry))
                .slice(0, 5);
            return {
                answer,
                productIds,
                followUps: [...new Set((Array.isArray(data.followUps) ? data.followUps : []).map((entry) => safeString(entry)).filter(Boolean))].slice(0, 3),
                toolRuns,
                iterations: iteration,
                observedProducts: [...observedById.values()],
                proposedAction,
                provider,
                providerModel,
            };
        }

        if (iteration === AGENT_MAX_ITERATIONS) break;
        if (answer && toolCalls.length > 0) {
            // Model answered while still calling tools: accept the answer but
            // only with observed ids.
            const allowed = new Set(observedById.keys());
            const productIds = [...new Set((Array.isArray(data.productIds) ? data.productIds : []).map((entry) => safeString(entry)).filter(Boolean))]
                .filter((entry) => allowed.has(entry))
                .slice(0, 5);
            if (productIds.length > 0 || observedById.size === 0) {
                return {
                    answer,
                    productIds,
                    followUps: [...new Set((Array.isArray(data.followUps) ? data.followUps : []).map((entry) => safeString(entry)).filter(Boolean))].slice(0, 3),
                    toolRuns,
                    iterations: iteration,
                    observedProducts: [...observedById.values()],
                    proposedAction,
                    provider,
                    providerModel,
                };
            }
        }
    }

    // Deterministic grounded close-out: never let a rambling model be the
    // last word — report what was actually observed.
    const observedProducts = [...observedById.values()];
    return {
        answer: observedProducts.length > 0
            ? `I verified these catalog matches with live lookups: ${observedProducts.slice(0, 3).map((entry) => `${entry.title} at Rs.${entry.price}`).join('; ')}. Ask me to compare them or check stock for any pick.`
            : 'I could not verify any catalog match with live lookups, so I am not recommending anything. Try a different query or category.',
        productIds: observedProducts.slice(0, 5).map((entry) => entry.id),
        followUps: observedProducts.length > 0 ? ['Compare these picks', 'Check stock for the top pick'] : ['Show trending products'],
        toolRuns,
        iterations: AGENT_MAX_ITERATIONS,
        observedProducts,
        proposedAction,
        provider,
        providerModel,
    };
};

const isAgentLoopEnabled = () => {
    const normalized = String(process.env.ASSISTANT_AGENT_LOOP_ENABLED ?? 'true').trim().toLowerCase();
    return !['0', 'false', 'no', 'off'].includes(normalized);
};

module.exports = {
    AGENT_LOOP_TOOLS,
    AGENT_MAX_ITERATIONS,
    isAgentLoopEnabled,
    runAgentLoop,
};
