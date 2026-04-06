const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const SERVER_DIR = path.resolve(__dirname, '..');
const RUN_LOG_DIR = path.resolve(ROOT_DIR, '.run-logs');

dotenv.config({ path: path.resolve(SERVER_DIR, '.env') });

process.env.INTELLIGENCE_SERVICE_TIMEOUT_MS = process.env.INTELLIGENCE_SERVICE_TIMEOUT_MS || '1500';
process.env.INTELLIGENCE_SERVICE_STREAM_TIMEOUT_MS = process.env.INTELLIGENCE_SERVICE_STREAM_TIMEOUT_MS || '3000';

const connectDB = require('../config/db');
const Product = require('../models/Product');
const { processAssistantTurn } = require('../services/ai/commerceAssistantService');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const deepClone = (value) => JSON.parse(JSON.stringify(value));

const toContextProduct = (product = {}) => ({
    id: safeString(product.id || product._id || product.externalId || ''),
    title: safeString(product.title || product.displayTitle || ''),
    brand: safeString(product.brand || ''),
    category: safeString(product.category || ''),
    price: Number(product.price || 0),
    originalPrice: Number(product.originalPrice || product.price || 0),
    discountPercentage: Number(product.discountPercentage || 0),
    image: safeString(product.image || ''),
    stock: Number(product.stock || 0),
    rating: Number(product.rating || 0),
    ratingCount: Number(product.ratingCount || 0),
    warranty: safeString(product.warranty || ''),
    deliveryTime: safeString(product.deliveryTime || ''),
});

const routeForPage = (page = '') => {
    switch (safeString(page).toLowerCase()) {
        case 'home': return '/';
        case 'cart': return '/cart';
        case 'checkout': return '/checkout';
        case 'orders': return '/orders';
        case 'profile': return '/profile';
        case 'wishlist': return '/wishlist';
        case 'marketplace': return '/marketplace';
        case 'deals': return '/deals';
        case 'trending': return '/trending';
        case 'new_arrivals': return '/new-arrivals';
        case 'compare': return '/compare';
        case 'bundles': return '/bundles';
        case 'visual_search': return '/visual-search';
        case 'support': return '/profile?tab=support';
        default: return '';
    }
};

const ensureRunLogDir = () => {
    if (!fs.existsSync(RUN_LOG_DIR)) fs.mkdirSync(RUN_LOG_DIR, { recursive: true });
};

const addPromptFactory = () => {
    const prompts = [];
    const addPrompt = (prompt) => {
        prompts.push({
            id: prompts.length + 1,
            assistantMode: 'chat',
            sessionKey: 'default',
            ...prompt,
        });
    };

    const searchPrompt = (question, overrides = {}) => addPrompt({
        category: 'search',
        sessionKey: overrides.sessionKey || 'search_discovery',
        question,
        baseContext: { route: '/products', routeLabel: 'Product listing' },
        expectation: { intents: ['product_search'], surfaces: ['product_results'], minProducts: 1 },
        ...overrides,
    });

    const navigationPrompt = (question, overrides = {}) => addPrompt({
        category: 'navigation',
        sessionKey: overrides.sessionKey || 'navigation',
        question,
        baseContext: { route: '/', routeLabel: 'Home feed' },
        expectation: { intents: ['navigation', 'support'], actionTypes: ['navigate_to'] },
        ...overrides,
    });

    const supportPrompt = (question, overrides = {}) => addPrompt({
        category: 'support',
        sessionKey: overrides.sessionKey || 'support',
        question,
        baseContext: {
            route: '/orders',
            routeLabel: 'Orders',
            activeOrderId: 'ORD-12345',
            currentOrderId: 'ORD-12345',
            supportContext: { orderId: 'ORD-12345' },
        },
        expectation: {
            intents: ['support', 'navigation', 'general_knowledge'],
            actionTypes: ['navigate_to'],
            allowAnswerOnly: true,
        },
        ...overrides,
    });

    const cartPrompt = (question, overrides = {}) => addPrompt({
        category: 'cart_checkout',
        sessionKey: overrides.sessionKey || 'cart',
        question,
        baseContext: {
            route: '/cart',
            routeLabel: 'Cart',
            cartSummary: { itemCount: 2, subtotal: 38998 },
        },
        expectation: { intents: ['cart_action', 'navigation', 'general_knowledge'], allowAnswerOnly: true },
        ...overrides,
    });

    const productPrompt = (question, overrides = {}) => addPrompt({
        category: 'product_page',
        sessionKey: overrides.sessionKey || 'product_page',
        question,
        expectation: { intents: ['cart_action', 'product_search', 'general_knowledge', 'navigation'], allowAnswerOnly: true },
        ...overrides,
    });

    const systemPrompt = (question, overrides = {}) => addPrompt({
        category: 'system_aware',
        sessionKey: overrides.sessionKey || 'system',
        question,
        baseContext: { route: '/assistant', routeLabel: 'Assistant workspace' },
        expectation: { allowCannotVerify: true, allowAnswerOnly: true },
        ...overrides,
    });

    // 1-20 Search and discovery.
    [
        'show phones under 50000',
        'find samsung phones under 30000',
        'show laptops under 70000',
        'recommend gaming laptops under 90000',
        'show wireless headphones under 5000',
        'find books under 1000',
        'show shoes under 4000',
        'what are the best deals in electronics',
        'show trending phones',
        'show new arrival laptops',
        'compare iphone and samsung phones',
        'compare gaming laptops and work laptops',
        'show phones with good ratings under 20000',
        'find smartwatches under 10000',
        'show kitchen appliances under 15000',
        'show fashion deals for men',
        'recommend budget earbuds',
        'find oneplus phones',
        'show products below 1000',
        'show me something premium under 120000',
    ].forEach((question) => searchPrompt(question, { sessionKey: 'search_discovery' }));

    // 21-30 Stateful refinement.
    [
        'show phones under 50000',
        'only samsung',
        'show more',
        'cheaper ones',
        'only 4 star and above',
    ].forEach((question) => searchPrompt(question, { sessionKey: 'search_refine' }));

    addPrompt({
        category: 'search',
        sessionKey: 'search_refine',
        question: 'compare the first two',
        baseContext: { route: '/products', routeLabel: 'Product listing' },
        expectation: {
            intents: ['product_selection', 'product_search', 'general_knowledge'],
            minProducts: 2,
            allowAnswerOnly: true,
        },
    });
    addPrompt({
        category: 'search',
        sessionKey: 'search_refine',
        question: 'open the first one',
        baseContext: { route: '/products', routeLabel: 'Product listing' },
        expectation: {
            intents: ['product_selection', 'navigation', 'general_knowledge'],
            actionTypes: ['navigate_to'],
            allowAnswerOnly: true,
        },
    });
    addPrompt({
        category: 'cart_checkout',
        sessionKey: 'search_refine',
        question: 'add this to cart',
        baseContext: { route: '/products', routeLabel: 'Product listing' },
        useFirstVisibleProduct: true,
        expectation: {
            intents: ['cart_action'],
            surfaces: ['confirmation_card'],
            confirmationActionTypes: ['add_to_cart'],
        },
    });
    addPrompt({
        category: 'cart_checkout',
        sessionKey: 'search_refine',
        question: 'yes',
        baseContext: { route: '/products', routeLabel: 'Product listing' },
        expectation: { intents: ['cart_action'], actionTypes: ['add_to_cart'] },
    });
    navigationPrompt('go to cart', {
        sessionKey: 'search_refine',
        baseContext: { route: '/products', routeLabel: 'Product listing' },
        expectation: { intents: ['navigation'], actionTypes: ['navigate_to'] },
    });

    // 31-40 Product-page questions.
    addPrompt({
        category: 'product_page',
        sessionKey: 'product_page',
        question: 'tell me about this product',
        useSampleProduct: 'laptop',
        expectation: { intents: ['general_knowledge', 'product_search'], allowAnswerOnly: true },
    });
    [
        'is this in stock',
        'what is the price of this product',
        'what warranty does this have',
    ].forEach((question) => productPrompt(question, {
        sessionKey: 'product_page',
        useSampleProduct: 'laptop',
        expectation: { intents: ['general_knowledge'], allowAnswerOnly: true, requiresAnswer: true },
    }));
    productPrompt('add this to cart', {
        sessionKey: 'product_page',
        useSampleProduct: 'laptop',
        expectation: { intents: ['cart_action'], surfaces: ['confirmation_card'], confirmationActionTypes: ['add_to_cart'] },
    });
    addPrompt({
        category: 'product_page',
        sessionKey: 'product_page',
        question: 'yes',
        baseContext: { route: '/product', routeLabel: 'Product detail' },
        expectation: { intents: ['cart_action'], actionTypes: ['add_to_cart'] },
    });
    productPrompt('buy this now', {
        sessionKey: 'product_page',
        useSampleProduct: 'laptop',
        expectation: { intents: ['cart_action', 'navigation'], allowAnswerOnly: true },
    });
    navigationPrompt('go to checkout', {
        sessionKey: 'product_page',
        baseContext: { route: '/product', routeLabel: 'Product detail' },
        expectation: { intents: ['navigation'], actionTypes: ['navigate_to'], allowAnswerOnly: true },
    });
    productPrompt('compare this with other laptops', {
        sessionKey: 'product_page',
        useSampleProduct: 'laptop',
        expectation: { intents: ['product_search', 'general_knowledge', 'product_selection'], allowAnswerOnly: true },
    });
    productPrompt('show delivery info', {
        sessionKey: 'product_page',
        useSampleProduct: 'laptop',
        expectation: { intents: ['general_knowledge'], allowAnswerOnly: true, requiresAnswer: true },
    });

    // 41-50 Cart and checkout.
    cartPrompt('show my cart', {
        expectation: { intents: ['navigation', 'general_knowledge'], actionTypes: ['navigate_to'], allowAnswerOnly: true },
    });
    cartPrompt('what is my subtotal', {
        expectation: { intents: ['general_knowledge'], allowAnswerOnly: true, requiresAnswer: true },
    });
    cartPrompt('remove this from cart', {
        useSampleProduct: 'mobile',
        expectation: {
            intents: ['cart_action'],
            surfaces: ['confirmation_card'],
            confirmationActionTypes: ['remove_from_cart'],
            allowAnswerOnly: true,
        },
    });
    addPrompt({
        category: 'cart_checkout',
        sessionKey: 'cart',
        question: 'yes',
        baseContext: { route: '/cart', routeLabel: 'Cart', cartSummary: { itemCount: 2, subtotal: 38998 } },
        expectation: { intents: ['cart_action'], actionTypes: ['remove_from_cart', 'add_to_cart'], allowAnswerOnly: true },
    });
    cartPrompt('reduce quantity to one', {
        useSampleProduct: 'mobile',
        expectation: { intents: ['cart_action', 'general_knowledge'], allowAnswerOnly: true },
    });
    cartPrompt('apply a coupon', {
        expectation: { intents: ['general_knowledge', 'cart_action'], allowAnswerOnly: true, requiresAnswer: true },
    });
    navigationPrompt('go to checkout', {
        sessionKey: 'cart',
        baseContext: { route: '/cart', routeLabel: 'Cart' },
        expectation: { intents: ['navigation'], actionTypes: ['navigate_to'], allowAnswerOnly: true },
    });
    [
        'can i pay with upi',
        'is cash on delivery available',
    ].forEach((question) => cartPrompt(question, {
        expectation: { intents: ['general_knowledge'], allowAnswerOnly: true, requiresAnswer: true },
    }));
    cartPrompt('pay now', {
        expectation: { intents: ['navigation', 'general_knowledge', 'cart_action'], allowAnswerOnly: true },
    });

    // 51-65 Support.
    [
        'track my order ORD-12345',
        'my order is late',
        'i want a refund for ORD-12345',
        'replace my damaged item',
        'cancel my order ORD-12345',
        'connect me to support',
        'open help for a delivery issue',
        'my payment succeeded but order failed',
        'where can i see my returns',
        'start a support chat for this order',
        'i need warranty help',
        'i was charged twice',
        'the package arrived damaged',
        'talk to customer care',
        'escalate this issue',
    ].forEach((question) => supportPrompt(question));

    // 66-75 Navigation.
    [
        'take me to home',
        'open wishlist',
        'go to marketplace',
        'show my orders',
        'open profile',
        'take me to deals',
        'go to compare page',
        'open visual search',
        'take me to bundles',
        'show support tab in profile',
    ].forEach((question) => navigationPrompt(question));

    // 76-85 Marketplace and seller flows.
    [
        'show marketplace listings',
        'how do i become a seller',
        'open my listings',
        'show seller profile',
        'how do i create a new listing',
        'open trade-in',
        'show price alerts',
        'take me to mission control',
        'open seller tools',
        'go to marketplace support',
    ].forEach((question) => navigationPrompt(question, {
        category: 'marketplace',
        sessionKey: 'marketplace',
        baseContext: { route: '/marketplace', routeLabel: 'Marketplace' },
        expectation: {
            intents: ['navigation', 'support', 'general_knowledge'],
            actionTypes: ['navigate_to'],
            allowAnswerOnly: true,
        },
    }));

    // 86-90 Account.
    [
        'how do i log in',
        'open profile settings',
        'show my saved addresses',
        'where do i manage payment methods',
        'how do i verify my account',
    ].forEach((question) => navigationPrompt(question, {
        category: 'account',
        sessionKey: 'account',
        expectation: {
            intents: ['general_knowledge', 'navigation'],
            actionTypes: ['navigate_to'],
            allowAnswerOnly: true,
            requiresAnswer: /how|where/.test(question),
        },
    }));

    // 91-100 System-aware internal questions.
    [
        'where is the assistant workspace',
        'what route opens visual search',
        'how does support video work',
        'why is cart failing',
        'where is the ai controller',
        'explain the controlled commerce assistant route',
        'what powers the intelligence service',
        'where are the commerce assistant files',
        'how does checkout navigation confirmation work',
        'what happens if central intelligence is unavailable',
    ].forEach((question) => systemPrompt(question));

    return prompts;
};

const matchesExpectedAction = (result = {}, expectedTypes = []) => {
    const actualTypes = new Set();
    const assistantTurn = result?.assistantTurn || {};
    (Array.isArray(assistantTurn.actions) ? assistantTurn.actions : []).forEach((action) => {
        if (safeString(action?.type)) actualTypes.add(safeString(action.type));
    });
    const confirmationAction = assistantTurn?.ui?.confirmation?.action;
    if (safeString(confirmationAction?.type)) actualTypes.add(safeString(confirmationAction.type));
    return expectedTypes.some((expected) => actualTypes.has(expected));
};

const buildStatus = ({ result = null, error = null, expectation = {} }) => {
    if (error) {
        return { status: 'fail', reasons: [safeString(error.message || error)] };
    }

    const reasons = [];
    const intent = safeString(result?.assistantTurn?.intent || '');
    const surface = safeString(result?.assistantTurn?.ui?.surface || '');
    const answer = safeString(result?.answer || result?.assistantTurn?.response || '');
    const productCount = Array.isArray(result?.products) ? result.products.length : 0;
    const groundingStatus = safeString(result?.grounding?.status || '');
    const hasActions = Array.isArray(result?.assistantTurn?.actions) && result.assistantTurn.actions.length > 0;

    if (Array.isArray(expectation.intents) && expectation.intents.length > 0 && !expectation.intents.includes(intent)) {
        reasons.push(`intent:${intent || 'none'}`);
    }
    if (Array.isArray(expectation.surfaces) && expectation.surfaces.length > 0 && !expectation.surfaces.includes(surface)) {
        reasons.push(`surface:${surface || 'none'}`);
    }
    if (Number(expectation.minProducts || 0) > 0 && productCount < Number(expectation.minProducts || 0)) {
        reasons.push(`products:${productCount}`);
    }
    if (Array.isArray(expectation.actionTypes) && expectation.actionTypes.length > 0 && !matchesExpectedAction(result, expectation.actionTypes)) {
        reasons.push('action_mismatch');
    }
    if (Array.isArray(expectation.confirmationActionTypes) && expectation.confirmationActionTypes.length > 0 && !matchesExpectedAction(result, expectation.confirmationActionTypes)) {
        reasons.push('confirmation_action_mismatch');
    }
    if (expectation.requiresAnswer && !answer) {
        reasons.push('missing_answer');
    }

    if (expectation.allowCannotVerify && groundingStatus === 'cannot_verify') {
        return { status: 'fallback', reasons: reasons.length > 0 ? reasons : ['safe_cannot_verify'] };
    }
    if (reasons.length === 0) return { status: 'strong', reasons: [] };
    if (expectation.allowAnswerOnly && (answer || hasActions || productCount > 0)) return { status: 'partial', reasons };
    if (answer || hasActions || productCount > 0) return { status: 'partial', reasons };
    return { status: 'fail', reasons };
};

const getSampleProducts = async () => {
    const [mobile, laptop, headphone, book] = await Promise.all([
        Product.findOne({ isPublished: true, category: /^Mobiles$/i }).sort({ rating: -1, ratingCount: -1 }).lean(),
        Product.findOne({ isPublished: true, category: /^Laptops$/i }).sort({ rating: -1, ratingCount: -1 }).lean(),
        Product.findOne({ isPublished: true, category: /^Electronics$/i }).sort({ rating: -1, ratingCount: -1 }).lean(),
        Product.findOne({ isPublished: true, category: /^Books$/i }).sort({ rating: -1, ratingCount: -1 }).lean(),
    ]);

    return {
        mobile: mobile ? toContextProduct(mobile) : null,
        laptop: laptop ? toContextProduct(laptop) : null,
        headphone: headphone ? toContextProduct(headphone) : null,
        book: book ? toContextProduct(book) : null,
    };
};

const mergeContexts = (base = {}, patch = {}) => ({ ...deepClone(base || {}), ...deepClone(patch || {}) });

const seedContextWithProduct = (context = {}, product = null) => {
    if (!product) return context;
    return {
        ...context,
        route: context.route && context.route !== '/product' ? context.route : `/product/${encodeURIComponent(product.id)}`,
        routeLabel: context.routeLabel || 'Product detail',
        product,
        currentProduct: product,
        focusProduct: product,
        currentProductId: product.id,
        activeProductId: product.id,
    };
};

const createPromptRuntimeContext = ({ prompt, sessionState, samples }) => {
    let nextContext = mergeContexts(prompt.baseContext || {}, sessionState.context || {});
    if (prompt.useSampleProduct && samples[prompt.useSampleProduct]) {
        nextContext = seedContextWithProduct(nextContext, samples[prompt.useSampleProduct]);
    }
    if (prompt.useFirstVisibleProduct) {
        const firstVisible = Array.isArray(sessionState.context?.visibleProducts) ? sessionState.context.visibleProducts[0] : null;
        nextContext = seedContextWithProduct(nextContext, firstVisible || samples.mobile || samples.laptop);
    }
    return nextContext;
};

const updateSessionStateFromResult = ({ sessionState, result }) => {
    sessionState.sessionId = safeString(result?.assistantSession?.sessionId || sessionState.sessionId || '');

    if (result?.sessionMemory && typeof result.sessionMemory === 'object') {
        sessionState.context.sessionMemory = deepClone(result.sessionMemory);
    }
    if (Array.isArray(result?.products) && result.products.length > 0) {
        const visibleProducts = result.products.slice(0, 6).map((product) => toContextProduct(product));
        sessionState.context.visibleProducts = visibleProducts;
        sessionState.context.visibleProductIds = visibleProducts.map((product) => product.id).filter(Boolean);
        sessionState.context.candidateProductIds = sessionState.context.visibleProductIds.slice(0, 6);
    }

    const activeProduct = result?.sessionMemory?.activeProduct || result?.assistantTurn?.sessionMemory?.activeProduct || null;
    if (activeProduct && typeof activeProduct === 'object') {
        const normalized = toContextProduct(activeProduct);
        sessionState.context.currentProduct = normalized;
        sessionState.context.product = normalized;
        sessionState.context.currentProductId = normalized.id;
        sessionState.context.activeProductId = normalized.id;
    }

    const cartSummary = result?.assistantTurn?.ui?.cartSummary || result?.assistantTurn?.cartSummary || result?.cartSummary || null;
    if (cartSummary && typeof cartSummary === 'object') {
        sessionState.context.cartSummary = deepClone(cartSummary);
    }

    const actions = Array.isArray(result?.assistantTurn?.actions) ? result.assistantTurn.actions : [];
    const navigationAction = actions.find((action) => safeString(action?.type) === 'navigate_to');
    if (navigationAction) {
        const resolvedRoute = routeForPage(navigationAction.page);
        if (resolvedRoute) sessionState.context.route = resolvedRoute;
    }
};

const evaluatePrompts = async (prompts, samples) => {
    const sessionMap = new Map();
    const results = [];

    for (const prompt of prompts) {
        const sessionKey = safeString(prompt.sessionKey || 'default');
        const existing = sessionMap.get(sessionKey) || { sessionId: '', context: {} };
        const sessionState = { sessionId: existing.sessionId, context: deepClone(existing.context || {}) };
        const context = createPromptRuntimeContext({ prompt, sessionState, samples });

        let result = null;
        let error = null;
        const startedAt = Date.now();
        try {
            result = await processAssistantTurn({
                user: null,
                message: prompt.question,
                assistantMode: prompt.assistantMode || 'chat',
                sessionId: sessionState.sessionId,
                context,
            });
            updateSessionStateFromResult({ sessionState, result });
        } catch (caught) {
            error = caught;
        }

        sessionMap.set(sessionKey, sessionState);

        const scored = buildStatus({ result, error, expectation: prompt.expectation || {} });
        results.push({
            id: prompt.id,
            category: prompt.category,
            sessionKey,
            question: prompt.question,
            status: scored.status,
            reasons: scored.reasons,
            durationMs: Date.now() - startedAt,
            intent: safeString(result?.assistantTurn?.intent || ''),
            decision: safeString(result?.assistantTurn?.decision || ''),
            surface: safeString(result?.assistantTurn?.ui?.surface || ''),
            answer: safeString(result?.answer || result?.assistantTurn?.response || ''),
            productCount: Array.isArray(result?.products) ? result.products.length : 0,
            firstProductTitle: safeString(result?.products?.[0]?.title || ''),
            actionTypes: [
                ...(Array.isArray(result?.assistantTurn?.actions) ? result.assistantTurn.actions : []),
                result?.assistantTurn?.ui?.confirmation?.action || null,
            ].filter(Boolean).map((action) => safeString(action.type)).filter(Boolean),
            groundingStatus: safeString(result?.grounding?.status || ''),
            groundingReason: safeString(result?.grounding?.reason || ''),
            error: error ? safeString(error.message || error) : '',
        });
    }

    return results;
};

const summarizeResults = (results = []) => {
    const summary = {
        total: results.length,
        strong: 0,
        partial: 0,
        fail: 0,
        fallback: 0,
        byCategory: {},
        byIntent: {},
    };

    results.forEach((result) => {
        summary[result.status] += 1;
        if (!summary.byCategory[result.category]) {
            summary.byCategory[result.category] = { total: 0, strong: 0, partial: 0, fail: 0, fallback: 0 };
        }
        summary.byCategory[result.category].total += 1;
        summary.byCategory[result.category][result.status] += 1;
        const intentKey = result.intent || 'unknown';
        summary.byIntent[intentKey] = (summary.byIntent[intentKey] || 0) + 1;
    });

    return summary;
};

const formatPercent = (value, total) => (!total ? '0.0%' : `${((value / total) * 100).toFixed(1)}%`);

const renderMarkdownReport = ({ summary, results }) => {
    const lines = [];
    lines.push('# Commerce Assistant Top 100 Eval', '', `Generated at: ${new Date().toISOString()}`, '', '## Summary', '');
    lines.push(`- Total prompts: ${summary.total}`);
    lines.push(`- Strong: ${summary.strong} (${formatPercent(summary.strong, summary.total)})`);
    lines.push(`- Partial: ${summary.partial} (${formatPercent(summary.partial, summary.total)})`);
    lines.push(`- Fallback: ${summary.fallback} (${formatPercent(summary.fallback, summary.total)})`);
    lines.push(`- Fail: ${summary.fail} (${formatPercent(summary.fail, summary.total)})`, '', '## Category Breakdown', '');
    Object.entries(summary.byCategory).forEach(([category, stats]) => {
        lines.push(`- ${category}: ${stats.strong} strong, ${stats.partial} partial, ${stats.fallback} fallback, ${stats.fail} fail (${stats.total} total)`);
    });
    lines.push('', '## Strong Examples', '');
    results.filter((result) => result.status === 'strong').slice(0, 12).forEach((result) => {
        lines.push(`- #${result.id} ${result.question} -> ${result.intent}/${result.surface || 'no-surface'}${result.productCount ? ` (${result.productCount} products)` : ''}`);
    });
    lines.push('', '## Misses To Review', '');
    results.filter((result) => result.status === 'fail' || result.status === 'partial').slice(0, 20).forEach((result) => {
        lines.push(`- #${result.id} ${result.question} -> ${result.status}; intent=${result.intent || 'none'}; reasons=${result.reasons.join(', ') || 'n/a'}${result.error ? `; error=${result.error}` : ''}`);
    });
    lines.push('', '## Full Results', '');
    results.forEach((result) => {
        lines.push(`- #${result.id} [${result.category}] ${result.question}`);
        lines.push(`  status=${result.status}; intent=${result.intent || 'none'}; decision=${result.decision || 'none'}; surface=${result.surface || 'none'}; actions=${result.actionTypes.join('|') || 'none'}; products=${result.productCount}; first=${result.firstProductTitle || 'n/a'}`);
        if (result.answer) lines.push(`  answer=${result.answer.slice(0, 240)}`);
        if (result.reasons.length > 0) lines.push(`  reasons=${result.reasons.join(', ')}`);
        if (result.error) lines.push(`  error=${result.error}`);
    });
    lines.push('');
    return lines.join('\n');
};

const main = async () => {
    ensureRunLogDir();
    await connectDB();
    const samples = await getSampleProducts();
    const prompts = addPromptFactory();
    const results = await evaluatePrompts(prompts, samples);
    const summary = summarizeResults(results);

    const jsonPath = path.resolve(RUN_LOG_DIR, 'commerce-assistant-top-100-eval.json');
    const mdPath = path.resolve(RUN_LOG_DIR, 'commerce-assistant-top-100-eval.md');

    fs.writeFileSync(jsonPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        samples,
        summary,
        results,
    }, null, 2));
    fs.writeFileSync(mdPath, renderMarkdownReport({ summary, results }));

    console.log(JSON.stringify({ jsonPath, mdPath, summary }, null, 2));
};

main()
    .catch((error) => {
        console.error(error?.stack || error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => {});
    });
