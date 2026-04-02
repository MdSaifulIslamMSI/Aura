const {
    fetchProductById,
    resolveComparisonProducts,
    resolveGroundedCatalog,
} = require('./assistantCatalogAdapter');
const { buildSupportDraft } = require('./assistantSupportAdapter');
const { safeString } = require('./assistantContract');

const HELP_PATTERN = /^(?:help|what can you do|how does this work|capabilities)\??$/i;
const SUPPORT_PATTERN = /\b(support|refund|return|replace|replacement|cancel order|issue|problem|complaint|payment failed|blocked account|suspended)\b/i;
const CHECKOUT_PATTERN = /\b(checkout|place order|pay now|complete purchase)\b/i;
const CART_PATTERN = /\b(cart|bag|basket|show cart|view cart|open cart)\b/i;
const ADD_TO_CART_PATTERN = /\b(add(?: this| it| that)?(?: to)?(?: my)? cart|buy this|buy it)\b/i;
const COMPARE_PATTERN = /\b(compare|vs|versus)\b/i;
const PRODUCT_REFERENCE_PATTERN = /\b(first|1st|second|2nd|third|3rd)\b/i;

const resolveOrdinalIndex = (message = '') => {
    const normalized = safeString(message).toLowerCase();
    if (/\b(first|1st)\b/.test(normalized)) return 0;
    if (/\b(second|2nd)\b/.test(normalized)) return 1;
    if (/\b(third|3rd)\b/.test(normalized)) return 2;
    return -1;
};

const buildNoResultsCard = (message = 'No grounded products matched that request yet.') => ({
    type: 'empty_state',
    id: 'empty-state',
    title: 'Refine the brief',
    description: message,
});

const buildProductCards = (products = []) => products.slice(0, 3).map((product, index) => ({
    type: 'product',
    id: `product:${product.id}:${index}`,
    title: index === 0 ? 'Best next option' : 'Also worth a look',
    description: product.brand
        ? `${product.brand} in ${product.category || 'this category'}`
        : (product.category || 'Grounded catalog match'),
    product,
}));

const buildProductFocusOutcome = (product, replyText) => ({
    reply: {
        text: replyText,
        intent: 'product_focus',
        confidence: 0.91,
    },
    cards: buildProductCards([product]),
    actions: [
        {
            type: 'open_product',
            label: 'Open product',
            productId: product.id,
        },
        {
            type: 'add_to_cart',
            label: 'Add to cart',
            productId: product.id,
            quantity: 1,
        },
    ],
    supportDraft: null,
    sessionPatch: {
        activeProductId: product.id,
        lastProductIds: [product.id],
    },
    telemetry: {
        source: 'product_focus',
        retrievalHits: 1,
    },
});

const buildCartOutcome = (cartSummary = {}, intent = 'cart_review') => ({
    reply: {
        text: intent === 'checkout'
            ? 'Your cart is ready for checkout. Review the totals, then continue through the normal checkout flow.'
            : 'Here is the current cart snapshot so you can decide the next move without leaving the assistant.',
        intent,
        confidence: 0.94,
    },
    cards: [{
        type: 'cart_summary',
        id: 'cart-summary',
        title: 'Current cart',
        description: 'This snapshot comes from the live commerce store.',
        cartSummary,
    }],
    actions: [
        {
            type: intent === 'checkout' ? 'open_checkout' : 'open_cart',
            label: intent === 'checkout' ? 'Open checkout' : 'Open cart',
            path: intent === 'checkout' ? '/checkout' : '/cart',
        },
    ],
    supportDraft: null,
    sessionPatch: {},
    telemetry: {
        source: 'cart_context',
        retrievalHits: 0,
    },
});

const resolveReferencedProduct = async ({ message = '', session = {}, commerceContext = {} } = {}) => {
    const ordinalIndex = resolveOrdinalIndex(message);
    const lastProductIds = Array.isArray(session?.lastProductIds) ? session.lastProductIds : [];
    const candidateProductIds = Array.isArray(commerceContext?.candidateProductIds) ? commerceContext.candidateProductIds : [];
    const activeProductId = safeString(commerceContext?.activeProductId || session?.activeProductId || '');

    const referenceIds = [
        ...(ordinalIndex >= 0 && lastProductIds[ordinalIndex] ? [lastProductIds[ordinalIndex]] : []),
        ...(ordinalIndex >= 0 && candidateProductIds[ordinalIndex] ? [candidateProductIds[ordinalIndex]] : []),
        activeProductId,
        lastProductIds[0],
        candidateProductIds[0],
    ].map((entry) => safeString(entry)).filter(Boolean);

    for (const productId of referenceIds) {
        const product = await fetchProductById(productId);
        if (product?.id) return product;
    }

    return null;
};

const routeAssistantCommerceTurn = async ({
    message = '',
    routeContext = {},
    commerceContext = {},
    session = {},
}) => {
    const normalizedMessage = safeString(message);
    const normalizedLower = normalizedMessage.toLowerCase();
    const cartSummary = commerceContext?.cartSummary || {};

    if (HELP_PATTERN.test(normalizedMessage)) {
        return {
            reply: {
                text: 'Tell me what you want to buy, compare, or fix. I can surface grounded product options, summarize the cart, and prepare a clean support handoff.',
                intent: 'general_help',
                confidence: 0.98,
            },
            cards: [],
            actions: [{
                type: 'open_cart',
                label: 'Review cart',
                path: '/cart',
            }],
            supportDraft: null,
            sessionPatch: {},
            telemetry: {
                source: 'help',
                retrievalHits: 0,
            },
        };
    }

    if (SUPPORT_PATTERN.test(normalizedMessage)) {
        const supportDraft = buildSupportDraft({
            message: normalizedMessage,
            routeContext,
            session,
        });

        return {
            reply: {
                text: 'This looks like a support workflow, so I prepared a structured handoff instead of mixing it into the shopping thread.',
                intent: 'support_handoff',
                confidence: 0.95,
            },
            cards: [{
                type: 'empty_state',
                id: 'support-handoff',
                title: 'Support handoff ready',
                description: 'Open the support desk to continue with durable ticketing and escalation.',
            }],
            actions: [{
                type: 'open_support',
                label: 'Open support',
            }],
            supportDraft,
            sessionPatch: {
                lastSupportDraft: supportDraft,
            },
            telemetry: {
                source: 'support_handoff',
                retrievalHits: 0,
            },
        };
    }

    if (CHECKOUT_PATTERN.test(normalizedMessage)) {
        return buildCartOutcome(cartSummary, 'checkout');
    }

    if (CART_PATTERN.test(normalizedLower)) {
        return buildCartOutcome(cartSummary, 'cart_review');
    }

    if (ADD_TO_CART_PATTERN.test(normalizedMessage)) {
        const product = await resolveReferencedProduct({
            message: normalizedMessage,
            session,
            commerceContext,
        });

        if (!product?.id) {
            return {
                reply: {
                    text: 'I need a grounded product before suggesting an add-to-cart CTA. Try naming the product or open it first.',
                    intent: 'product_focus',
                    confidence: 0.54,
                },
                cards: [buildNoResultsCard('Open a product or ask for a more specific search before adding to cart.')],
                actions: [],
                supportDraft: null,
                sessionPatch: {},
                telemetry: {
                    source: 'add_to_cart_missing_context',
                    retrievalHits: 0,
                },
            };
        }

        return buildProductFocusOutcome(
            product,
            `I found ${product.title}. Use the CTA below to add it through the standard cart flow.`
        );
    }

    if (COMPARE_PATTERN.test(normalizedMessage)) {
        const products = await resolveComparisonProducts({
            message: normalizedMessage,
            candidateProductIds: commerceContext?.candidateProductIds || session?.lastProductIds || [],
        });

        if (products.length < 2) {
            return {
                reply: {
                    text: 'I could not ground two strong products for a side-by-side comparison yet. Add clearer model names or open a tighter category.',
                    intent: 'comparison',
                    confidence: 0.62,
                },
                cards: [buildNoResultsCard('Try a query like "iPhone 15 vs Samsung S24" or launch from a product/category context.')],
                actions: [],
                supportDraft: null,
                sessionPatch: {},
                telemetry: {
                    source: 'comparison',
                    retrievalHits: products.length,
                },
            };
        }

        return {
            reply: {
                text: `I grounded ${products.length} products for comparison. Start with the stronger fit, then inspect the runner-up if you need a tradeoff.`,
                intent: 'comparison',
                confidence: 0.9,
            },
            cards: [{
                type: 'comparison',
                id: 'comparison',
                title: 'Side-by-side comparison',
                description: 'Grounded options from the current commerce context.',
                products,
            }],
            actions: [
                {
                    type: 'open_product',
                    label: 'Open lead product',
                    productId: products[0].id,
                },
                {
                    type: 'add_to_cart',
                    label: 'Add lead product',
                    productId: products[0].id,
                    quantity: 1,
                },
            ],
            supportDraft: null,
            sessionPatch: {
                lastProductIds: products.map((product) => product.id),
                activeProductId: products[0].id,
            },
            telemetry: {
                source: 'comparison',
                retrievalHits: products.length,
            },
        };
    }

    const grounded = await resolveGroundedCatalog(normalizedMessage);
    if (grounded.products.length > 0) {
        const leadingProduct = grounded.products[0];
        const leadingCategory = safeString(leadingProduct?.category || grounded.category || '');

        return {
            reply: {
                text: grounded.actionType === 'compare'
                    ? `I found grounded products for comparison. Start with ${leadingProduct.title}.`
                    : `I found ${grounded.products.length} grounded product option${grounded.products.length === 1 ? '' : 's'} for that brief.`,
                intent: grounded.actionType === 'compare' ? 'comparison' : 'product_search',
                confidence: 0.88,
            },
            cards: grounded.actionType === 'compare' && grounded.products.length >= 2
                ? [{
                    type: 'comparison',
                    id: 'grounded-comparison',
                    title: 'Grounded comparison set',
                    description: 'Pulled from the active commerce catalog.',
                    products: grounded.products.slice(0, 2),
                }]
                : buildProductCards(grounded.products),
            actions: [
                {
                    type: 'open_product',
                    label: 'Open top result',
                    productId: leadingProduct.id,
                },
                {
                    type: 'add_to_cart',
                    label: 'Add top result',
                    productId: leadingProduct.id,
                    quantity: 1,
                },
                ...(leadingCategory ? [{
                    type: 'open_category',
                    label: 'Browse category',
                    category: leadingCategory,
                }] : []),
            ],
            supportDraft: null,
            sessionPatch: {
                lastQuery: normalizedMessage,
                lastProductIds: grounded.products.map((product) => product.id),
                activeProductId: leadingProduct.id,
            },
            telemetry: {
                source: `grounded_${grounded.actionType || 'search'}`,
                retrievalHits: grounded.products.length,
            },
        };
    }

    const activeProduct = await resolveReferencedProduct({
        message: normalizedMessage,
        session,
        commerceContext,
    });
    if (activeProduct?.id && (routeContext?.entityType === 'product' || PRODUCT_REFERENCE_PATTERN.test(normalizedMessage))) {
        return buildProductFocusOutcome(
            activeProduct,
            `You are already close to ${activeProduct.title}. I kept the next moves focused on that product instead of widening the search.`
        );
    }

    return {
        reply: {
            text: 'I could not ground a clean commerce match yet. Tighten the brief with a product name, category, budget, or comparison target.',
            intent: 'product_search',
            confidence: 0.48,
        },
        cards: [buildNoResultsCard()],
        actions: [],
        supportDraft: null,
        sessionPatch: {
            lastQuery: normalizedMessage,
        },
        telemetry: {
            source: 'no_results',
            retrievalHits: 0,
        },
    };
};

module.exports = {
    routeAssistantCommerceTurn,
};
