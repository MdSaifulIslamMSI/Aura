const ProductReview = require('../../models/ProductReview');
const logger = require('../../utils/logger');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const uniq = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((entry) => safeString(entry)).filter(Boolean))];

const STATIC_KNOWLEDGE_CHUNKS = Object.freeze([
    {
        id: 'policy:return-refund',
        sourceType: 'policy',
        title: 'Return and refund policy',
        policyType: 'return_refund',
        keywords: ['return', 'returns', 'refund', 'refunded', 'replace', 'replacement', 'damaged', 'defect', 'wrong item'],
        text: 'Return, refund, and replacement requests must be started from the order command center or support handoff. Eligibility is checked from live order status, delivery state, item category, payment state, seller policy, and existing command-center requests. Do not promise a refund, replacement, pickup, or deadline until the order API confirms eligibility.',
    },
    {
        id: 'policy:order-cancellation',
        sourceType: 'policy',
        title: 'Order cancellation rules',
        policyType: 'cancellation',
        keywords: ['cancel', 'cancellation', 'cancel order', 'stop order'],
        text: 'Order cancellation is a live order action. The assistant may prepare the cancellation workflow, but the order API must confirm that the order is not delivered and not already cancelled. Paid order cancellation can trigger the refund flow only after the cancellation service accepts the request.',
    },
    {
        id: 'policy:price-stock-coupon',
        sourceType: 'policy',
        title: 'Price, stock, and coupon accuracy',
        policyType: 'pricing_inventory_coupon',
        keywords: ['price', 'stock', 'inventory', 'availability', 'coupon', 'promo', 'discount code', 'tax', 'offer'],
        text: 'Live price, stock, taxes, shipping charges, and coupon validity come from product, cart, checkout, and order APIs. The assistant must not invent discounts, coupon eligibility, stock, delivery dates, or tax totals. Coupon validation happens through checkout quote logic after the cart and payment context are known.',
    },
    {
        id: 'policy:delivery-tracking',
        sourceType: 'policy',
        title: 'Delivery and tracking',
        policyType: 'delivery_tracking',
        keywords: ['delivery', 'shipping', 'tracking', 'track', 'order status', 'invoice', 'where is my order'],
        text: 'Delivery status, tracking timelines, invoices, and order totals must be read from the order database or order timeline API. RAG policy text can explain the workflow, but the assistant should use order tools for account-specific status.',
    },
    {
        id: 'policy:warranty-support',
        sourceType: 'policy',
        title: 'Warranty and support handoff',
        policyType: 'warranty_support',
        keywords: ['warranty', 'guarantee', 'support', 'complaint', 'service', 'manual', 'repair'],
        text: 'Warranty and technical support answers should use product specs, manuals, warranty fields, and support history when available. Complaints, damaged item reports, warranty claims, and ambiguous policy edge cases should offer a human support handoff instead of inventing a resolution.',
    },
    {
        id: 'faq:size-fit',
        sourceType: 'faq',
        title: 'Size and fit guidance',
        policyType: 'size_fit',
        keywords: ['size', 'fit', 'shoe size', 'shirt size', 'jeans size', 'fashion', 'clothing', 'apparel'],
        text: 'For size or fit questions, prefer product size guides, brand sizing notes, user reviews, and category metadata. If size data is missing, ask for the user measurement or preferred fit instead of guessing.',
    },
    {
        id: 'faq:reviews',
        sourceType: 'faq',
        title: 'Using reviews safely',
        policyType: 'reviews',
        keywords: ['review', 'reviews', 'rating', 'rated', 'students', 'battery issue', 'true size', 'quality'],
        text: 'Reviews are useful for real-world fit, durability, battery, comfort, and quality signals. Treat review snippets as customer experience evidence, not guaranteed product facts. Balance ratings with price, stock, specs, and verified-purchase signals.',
    },
]);

const tokenize = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

const truncate = (value = '', maxLength = 700) => {
    const text = safeString(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trim()}...`;
};

const stringifySpec = (spec = {}) => {
    const key = safeString(spec?.key || spec?.name || spec?.label || '');
    const value = safeString(spec?.value || spec?.text || '');
    return key && value ? `${key}: ${value}` : safeString(value || key);
};

const buildProductKnowledgeChunks = (products = []) => (Array.isArray(products) ? products : [])
    .map((product) => {
        const id = safeString(product?.id || product?._id || '');
        const title = safeString(product?.displayTitle || product?.title || 'Product');
        const highlights = Array.isArray(product?.highlights) ? product.highlights.map((entry) => safeString(entry)).filter(Boolean) : [];
        const specifications = Array.isArray(product?.specifications)
            ? product.specifications.map((entry) => stringifySpec(entry)).filter(Boolean)
            : [];
        const parts = [
            safeString(product?.description || ''),
            highlights.length ? `Highlights: ${highlights.join('; ')}` : '',
            specifications.length ? `Specifications: ${specifications.join('; ')}` : '',
        ].filter(Boolean);

        if (!id || !parts.length) return null;
        return {
            id: `product-knowledge:${id}`,
            sourceType: 'manual',
            title: `${title} product knowledge`,
            policyType: 'product_specs',
            text: truncate(parts.join(' '), 900),
            keywords: [
                title,
                product?.brand,
                product?.category,
                'specs',
                'specifications',
                'manual',
                'features',
                ...highlights,
            ],
            metadata: {
                productId: id,
                brand: safeString(product?.brand || ''),
                category: safeString(product?.category || ''),
            },
        };
    })
    .filter(Boolean);

const getProductObjectIds = (products = []) => uniq((Array.isArray(products) ? products : [])
    .map((product) => safeString(product?._id || product?.mongoId || ''))
    .filter(Boolean));

const loadReviewKnowledgeChunks = async (products = [], { limit = 8 } = {}) => {
    const productObjectIds = getProductObjectIds(products);
    if (!productObjectIds.length || ProductReview?.db?.readyState !== 1) return [];

    try {
        const productByObjectId = new Map((Array.isArray(products) ? products : [])
            .map((product) => [safeString(product?._id || product?.mongoId || ''), product]));
        const reviews = await ProductReview.find({
            product: { $in: productObjectIds },
            status: 'published',
        })
            .sort({ helpfulCount: -1, createdAt: -1 })
            .limit(Math.max(1, Number(limit || 8)))
            .select('product rating comment isVerifiedPurchase helpfulCount createdAt')
            .lean();

        return (Array.isArray(reviews) ? reviews : [])
            .map((review) => {
                const product = productByObjectId.get(safeString(review?.product || '')) || {};
                const productId = safeString(product?.id || product?._id || review?.product || '');
                const title = safeString(product?.displayTitle || product?.title || 'Product review');
                const rating = Number(review?.rating || 0);
                const verified = review?.isVerifiedPurchase ? 'verified purchase' : 'customer review';
                return {
                    id: `review:${safeString(review?._id || `${productId}-${rating}-${safeString(review?.createdAt || '')}`)}`,
                    sourceType: 'review',
                    title: `${title} review`,
                    policyType: 'review_signal',
                    text: truncate(`${rating ? `${rating}/5 ` : ''}${verified}: ${safeString(review?.comment || '')}`, 650),
                    keywords: [title, product?.brand, product?.category, 'review', 'rating', 'quality', 'fit', 'battery', 'comfort'],
                    metadata: {
                        productId,
                        rating,
                        isVerifiedPurchase: Boolean(review?.isVerifiedPurchase),
                        helpfulCount: Math.max(0, Number(review?.helpfulCount || 0)),
                    },
                };
            })
            .filter((chunk) => safeString(chunk.text));
    } catch (error) {
        logger.warn('assistant.knowledge_reviews.fallback', { error: error.message });
        return [];
    }
};

const scoreChunk = (query = '', chunk = {}) => {
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return 0;

    const searchable = [
        chunk.id,
        chunk.title,
        chunk.policyType,
        chunk.text,
        ...(Array.isArray(chunk.keywords) ? chunk.keywords : []),
        chunk.metadata?.brand,
        chunk.metadata?.category,
    ].filter(Boolean).join(' ');
    const searchTokens = new Set(tokenize(searchable));
    const overlap = queryTokens.reduce((count, token) => count + (searchTokens.has(token) ? 1 : 0), 0);
    let score = overlap / Math.max(1, queryTokens.length);

    const normalizedQuery = safeString(query).toLowerCase();
    (Array.isArray(chunk.keywords) ? chunk.keywords : []).forEach((keyword) => {
        const normalizedKeyword = safeString(keyword).toLowerCase();
        if (normalizedKeyword && normalizedQuery.includes(normalizedKeyword)) score += 0.45;
    });
    if (normalizedQuery.includes('return') && chunk.policyType === 'return_refund') score += 1.8;
    if (normalizedQuery.includes('refund') && chunk.policyType === 'return_refund') score += 1.8;
    if (normalizedQuery.includes('cancel') && chunk.policyType === 'cancellation') score += 1.8;
    if ((normalizedQuery.includes('coupon') || normalizedQuery.includes('discount')) && chunk.policyType === 'pricing_inventory_coupon') score += 1.8;
    if ((normalizedQuery.includes('stock') || normalizedQuery.includes('available') || normalizedQuery.includes('price')) && chunk.policyType === 'pricing_inventory_coupon') score += 1.4;
    if ((normalizedQuery.includes('delivery') || normalizedQuery.includes('track')) && chunk.policyType === 'delivery_tracking') score += 1.4;
    if ((normalizedQuery.includes('warranty') || normalizedQuery.includes('support')) && chunk.policyType === 'warranty_support') score += 1.4;
    if ((normalizedQuery.includes('review') || normalizedQuery.includes('rating')) && chunk.sourceType === 'review') score += 1.1;
    if ((normalizedQuery.includes('spec') || normalizedQuery.includes('manual') || normalizedQuery.includes('feature')) && chunk.sourceType === 'manual') score += 1.1;

    return Number(score.toFixed(4));
};

const buildKnowledgeAnswerText = (chunks = [], { query = '' } = {}) => {
    const ranked = (Array.isArray(chunks) ? chunks : []).slice(0, 3);
    if (!ranked.length) {
        return 'I could not find a grounded policy or knowledge match for that. Try asking with the product, order, or policy name.';
    }

    const lines = ranked.map((chunk) => `- ${safeString(chunk.title)}: ${truncate(chunk.text, 260)}`);
    const liveDataReminder = /\b(price|stock|coupon|delivery|track|order|cancel|refund|return)\b/i.test(query)
        ? 'For live eligibility or account-specific status, I will use the commerce tools instead of guessing.'
        : '';

    return [
        'Here is the grounded store guidance I found:',
        lines.join('\n'),
        liveDataReminder,
    ].filter(Boolean).join('\n\n');
};

const retrieveCommerceKnowledge = async ({
    query = '',
    products = [],
    limit = 6,
} = {}) => {
    const startedAt = Date.now();
    const candidates = [
        ...STATIC_KNOWLEDGE_CHUNKS,
        ...buildProductKnowledgeChunks(products),
        ...await loadReviewKnowledgeChunks(products, { limit: Math.max(2, Number(limit || 6)) }),
    ];

    const ranked = candidates
        .map((chunk) => ({
            ...chunk,
            text: truncate(chunk.text),
            score: scoreChunk(query, chunk),
        }))
        .filter((chunk) => chunk.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, Number(limit || 6)));

    const citations = ranked.map((chunk) => ({
        id: chunk.id,
        label: chunk.title,
        type: chunk.sourceType,
        title: chunk.title,
        excerpt: truncate(chunk.text, 240),
        score: Math.min(1, Number(chunk.score || 0) / 3),
        metadata: {
            policyType: safeString(chunk.policyType || ''),
            ...(chunk.metadata && typeof chunk.metadata === 'object' ? chunk.metadata : {}),
        },
    }));

    return {
        chunks: ranked,
        citations,
        contextText: ranked.map((chunk) => `${chunk.title}: ${chunk.text}`).join('\n\n'),
        hitCount: ranked.length,
        toolRun: {
            id: `knowledge-${Date.now()}`,
            toolName: 'retrieve_knowledge',
            status: 'completed',
            latencyMs: Math.max(0, Date.now() - startedAt),
            summary: `${ranked.length} knowledge chunk${ranked.length === 1 ? '' : 's'}`,
            inputPreview: { query: safeString(query) },
            outputPreview: { chunkIds: ranked.map((chunk) => chunk.id) },
        },
    };
};

module.exports = {
    STATIC_KNOWLEDGE_CHUNKS,
    buildKnowledgeAnswerText,
    retrieveCommerceKnowledge,
    __testables: {
        buildProductKnowledgeChunks,
        scoreChunk,
        tokenize,
    },
};
