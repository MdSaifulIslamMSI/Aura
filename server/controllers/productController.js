const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const Order = require('../models/Order');
const ProductReview = require('../models/ProductReview');
const {
    queryProducts,
    getProductByIdentifier,
    createManualProduct,
    updateManualProduct,
    deleteManualProduct,
} = require('../services/catalogService');
const {
    computeDealDna,
    getCompatibilityGraph,
    buildSmartBundle,
} = require('../services/commerceIntelligenceService');

const REVIEW_LIMIT_DEFAULT = 8;
const REVIEW_LIMIT_MAX = 20;
const REVIEW_VIDEO_MAX = 3;
const REVIEW_MEDIA_MAX = 8;

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || min, min), max);

const isAllowedMediaUrl = (url) => (
    /^https?:\/\/[^\s]+$/i.test(url) || /^\/uploads\/[^\s]+$/i.test(url)
);

const normalizeReviewMedia = (media = []) => {
    if (!Array.isArray(media)) return [];

    const unique = new Set();
    const output = [];
    let videoCount = 0;

    for (const raw of media) {
        const type = String(raw?.type || '').trim().toLowerCase();
        const url = String(raw?.url || '').trim();
        const caption = String(raw?.caption || '').trim().slice(0, 160);

        if (!['image', 'video'].includes(type)) continue;
        if (!url || !isAllowedMediaUrl(url)) continue;
        if (type === 'video' && videoCount >= REVIEW_VIDEO_MAX) continue;

        const dedupeKey = `${type}:${url.toLowerCase()}`;
        if (unique.has(dedupeKey)) continue;
        unique.add(dedupeKey);

        if (type === 'video') {
            videoCount += 1;
        }
        output.push({ type, url, caption });
        if (output.length >= REVIEW_MEDIA_MAX) break;
    }

    return output;
};

const buildReviewSummary = async (productId) => {
    const [avgDoc, breakdownDocs] = await Promise.all([
        ProductReview.aggregate([
            { $match: { product: productId, status: 'published' } },
            {
                $group: {
                    _id: null,
                    totalReviews: { $sum: 1 },
                    averageRating: { $avg: '$rating' },
                    withMediaCount: {
                        $sum: {
                            $cond: [{ $gt: [{ $size: '$media' }, 0] }, 1, 0],
                        },
                    },
                },
            },
        ]),
        ProductReview.aggregate([
            { $match: { product: productId, status: 'published' } },
            {
                $group: {
                    _id: '$rating',
                    count: { $sum: 1 },
                },
            },
        ]),
    ]);

    const averageRating = Number((avgDoc?.[0]?.averageRating || 0).toFixed(1));
    const totalReviews = Number(avgDoc?.[0]?.totalReviews || 0);
    const withMediaCount = Number(avgDoc?.[0]?.withMediaCount || 0);

    const ratingBreakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const bucket of breakdownDocs || []) {
        const rating = Number(bucket?._id || 0);
        if (rating >= 1 && rating <= 5) {
            ratingBreakdown[rating] = Number(bucket.count || 0);
        }
    }

    return {
        averageRating,
        totalReviews,
        withMediaCount,
        ratingBreakdown,
    };
};

// @desc    Fetch all products
// @route   GET /api/products
// @access  Public
// @desc    Fetch all products (with Search, Filter, Pagination)
// @route   GET /api/products
// @access  Public
const getProducts = asyncHandler(async (req, res, next) => {
    try {
        const result = await queryProducts(req.query);
        const includeDealDna = String(req.query.includeDealDna || '').toLowerCase() !== 'false';
        const products = includeDealDna
            ? (result.products || []).map((product) => ({
                ...product.toObject?.() || product,
                dealDna: computeDealDna(product),
            }))
            : result.products;
        res.json({
            products,
            nextCursor: result.nextCursor,
            total: result.total,
            page: result.page,
            pages: result.pages,
        });
    } catch (error) {
        if (error instanceof AppError) return next(error);
        logger.error('products.fetch_failed', {
            error: error.message,
            requestId: req.requestId,
        });
        return next(new AppError('Failed to fetch products', 500));
    }
});

// @desc    Fetch single product
// @route   GET /api/products/:id
// @access  Public
const getProductById = asyncHandler(async (req, res, next) => {
    const product = await getProductByIdentifier(req.params.id);

    if (product) {
        const serialized = product.toObject?.() || product;
        res.json({
            ...serialized,
            dealDna: computeDealDna(product),
        });
    } else {
        return next(new AppError('Product not found', 404));
    }
});

// @desc    Get product deal DNA score
// @route   GET /api/products/:id/deal-dna
// @access  Public
const getProductDealDna = asyncHandler(async (req, res, next) => {
    const product = await getProductByIdentifier(req.params.id);
    if (!product) {
        return next(new AppError('Product not found', 404));
    }
    return res.json({
        productId: product.id,
        title: product.title,
        dealDna: computeDealDna(product),
    });
});

// @desc    Get compatibility graph for product accessories
// @route   GET /api/products/:id/compatibility
// @access  Public
const getProductCompatibility = asyncHandler(async (req, res, next) => {
    const product = await getProductByIdentifier(req.params.id);
    if (!product) {
        return next(new AppError('Product not found', 404));
    }

    const graph = await getCompatibilityGraph(product, {
        limitPerType: req.query.limitPerType,
    });
    return res.json(graph);
});

// @desc    Get product reviews (verified customer feedback with media)
// @route   GET /api/products/:id/reviews
// @access  Public
const getProductReviews = asyncHandler(async (req, res, next) => {
    const product = await getProductByIdentifier(req.params.id);
    if (!product) {
        return next(new AppError('Product not found', 404));
    }

    const page = clamp(req.query.page || 1, 1, 10000);
    const limit = clamp(req.query.limit || REVIEW_LIMIT_DEFAULT, 1, REVIEW_LIMIT_MAX);
    const mediaOnly = String(req.query.mediaOnly || 'false').toLowerCase() === 'true';
    const minRating = Number(req.query.minRating || 0);

    const filter = {
        product: product._id,
        status: 'published',
    };
    if (mediaOnly) {
        filter['media.0'] = { $exists: true };
    }
    if (Number.isFinite(minRating) && minRating >= 1 && minRating <= 5) {
        filter.rating = { $gte: minRating };
    }

    const sortBy = String(req.query.sort || 'newest').toLowerCase();
    const sortMap = {
        newest: { createdAt: -1 },
        oldest: { createdAt: 1 },
        'top-rating': { rating: -1, createdAt: -1 },
        helpful: { helpfulCount: -1, createdAt: -1 },
    };
    const sort = sortMap[sortBy] || sortMap.newest;
    const skip = (page - 1) * limit;

    const [reviews, total, summary] = await Promise.all([
        ProductReview.find(filter)
            .populate('user', 'name avatar isVerified')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        ProductReview.countDocuments(filter),
        buildReviewSummary(product._id),
    ]);

    return res.json({
        success: true,
        reviews: (reviews || []).map((review) => ({
            id: String(review._id),
            rating: review.rating,
            comment: review.comment,
            media: Array.isArray(review.media) ? review.media : [],
            helpfulCount: Number(review.helpfulCount || 0),
            isVerifiedPurchase: Boolean(review.isVerifiedPurchase),
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
            user: {
                id: String(review.user?._id || ''),
                name: review.user?.name || 'Verified Buyer',
                avatar: review.user?.avatar || '',
                isVerified: Boolean(review.user?.isVerified),
            },
        })),
        summary,
        pagination: {
            page,
            limit,
            total,
            pages: Math.max(1, Math.ceil(total / limit)),
        },
    });
});

// @desc    Create or update product review (verified purchase only)
// @route   POST /api/products/:id/reviews
// @access  Private
const createProductReview = asyncHandler(async (req, res, next) => {
    const product = await getProductByIdentifier(req.params.id);
    if (!product) {
        return next(new AppError('Product not found', 404));
    }

    const userId = req.user?._id;
    if (!userId) {
        return next(new AppError('Not authorized', 401));
    }

    const purchasedOrder = await Order.findOne({
        user: userId,
        'orderItems.product': product._id,
        $or: [
            { isDelivered: true },
            { isPaid: true },
            { paymentState: { $in: ['authorized', 'captured', 'paid', 'completed'] } },
        ],
    }).sort({ createdAt: -1 }).select('_id');

    if (!purchasedOrder) {
        return next(new AppError('Only customers with a real purchase can post a review for this product.', 403));
    }

    const media = normalizeReviewMedia(req.body.media || []);
    const nextReviewData = {
        rating: Number(req.body.rating),
        comment: String(req.body.comment || '').trim(),
        media,
        order: purchasedOrder._id,
        isVerifiedPurchase: true,
        status: 'published',
    };

    const existing = await ProductReview.findOne({
        product: product._id,
        user: userId,
    });

    let review;
    if (existing) {
        existing.rating = nextReviewData.rating;
        existing.comment = nextReviewData.comment;
        existing.media = nextReviewData.media;
        existing.order = nextReviewData.order;
        existing.isVerifiedPurchase = true;
        existing.status = 'published';
        review = await existing.save();
    } else {
        review = await ProductReview.create({
            product: product._id,
            user: userId,
            ...nextReviewData,
        });
    }

    const summary = await buildReviewSummary(product._id);
    await product.constructor.updateOne(
        { _id: product._id },
        {
            $set: {
                rating: summary.averageRating || 0,
                ratingCount: summary.totalReviews || 0,
            },
        }
    );

    return res.status(existing ? 200 : 201).json({
        success: true,
        message: existing ? 'Review updated successfully' : 'Review posted successfully',
        review: {
            id: String(review._id),
            rating: review.rating,
            comment: review.comment,
            media: review.media || [],
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
        },
        summary,
    });
});

// @desc    Build smart bundle from theme and budget
// @route   POST /api/products/bundles/build
// @access  Public
const buildProductBundle = asyncHandler(async (req, res, next) => {
    try {
        const result = await buildSmartBundle({
            theme: req.body.theme,
            budget: req.body.budget,
            maxItems: req.body.maxItems,
        });
        return res.json(result);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Unable to build smart bundle', 500));
    }
});

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
const deleteProduct = asyncHandler(async (req, res, next) => {
    try {
        const result = await deleteManualProduct(req.params.id);
        res.json(result);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError('Failed to delete product', 500));
    }
});

// @desc    Create a product
// @route   POST /api/products
// @access  Private/Admin
const createProduct = asyncHandler(async (req, res, next) => {
    try {
        const payload = {
            ...req.body,
            stock: req.body.countInStock ?? req.body.stock ?? 0,
        };
        const createdProduct = await createManualProduct(payload);
        res.status(201).json(createdProduct);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError('Failed to create product', 500));
    }
});

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Admin
const updateProduct = asyncHandler(async (req, res, next) => {
    try {
        const payload = {
            ...req.body,
            stock: req.body.countInStock ?? req.body.stock,
        };
        const product = await updateManualProduct(req.params.id, payload);
        res.json(product);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError('Failed to update product', 500));
    }
});

const sanitizeText = (value = '') => String(value || '').toLowerCase().trim();
const clampNumber = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const getMetaTokens = (imageMeta = {}) => {
    if (!imageMeta || typeof imageMeta !== 'object') return [];
    const width = Number(imageMeta.width) || 0;
    const height = Number(imageMeta.height) || 0;
    const ratio = (width > 0 && height > 0) ? (width / height) : 0;
    const tokens = [];

    if (ratio >= 1.3) tokens.push('laptop');
    if (ratio > 0 && ratio <= 0.82) tokens.push('mobile');

    const mimeType = sanitizeText(imageMeta.mimeType || '');
    if (mimeType.includes('png')) tokens.push('screenshot');
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) tokens.push('photo');

    return tokens;
};

const buildVisualTokens = (payload = {}) => {
    const combined = [payload.hints, payload.fileName, payload.imageUrl, ...getMetaTokens(payload.imageMeta)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const tokens = combined
        .replace(/https?:\/\/[^ ]+/g, ' ')
        .replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
        .filter((token) => ![
            'image', 'images', 'photo', 'jpeg', 'jpg', 'png', 'webp',
            'http', 'https', 'com', 'cdn', 'files', 'product', 'screenshot',
            'upload', 'clipboard',
        ].includes(token));

    return [...new Set(tokens)].slice(0, 10);
};

const getVisualConfidence = (product, tokens = []) => {
    if (!product) return 0.2;
    if (!Array.isArray(tokens) || tokens.length === 0) return 0.24;

    const titleText = sanitizeText(product.title);
    const brandText = sanitizeText(product.brand);
    const categoryText = sanitizeText(product.category);
    const descriptionText = sanitizeText(product.description || '');

    let weightedHits = 0;
    tokens.forEach((token) => {
        if (titleText.includes(token)) weightedHits += 1.4;
        else if (brandText.includes(token) || categoryText.includes(token)) weightedHits += 1.1;
        else if (descriptionText.includes(token)) weightedHits += 0.7;
    });

    const normalized = weightedHits / (tokens.length * 1.4);
    return clampNumber(Number(normalized.toFixed(3)), 0.15, 0.99);
};

const computePriceStats = (products = []) => {
    const prices = products
        .map((product) => Number(product.price) || 0)
        .filter((price) => price > 0)
        .sort((a, b) => a - b);

    if (prices.length === 0) {
        return {
            median: 0,
            min: 0,
            max: 0,
            count: 0,
        };
    }

    const midpoint = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0
        ? (prices[midpoint - 1] + prices[midpoint]) / 2
        : prices[midpoint];

    return {
        median: Math.round(median),
        min: prices[0],
        max: prices[prices.length - 1],
        count: prices.length,
    };
};

const buildPriceGap = ({ price, medianPrice, topPrice }) => {
    const safePrice = Number(price) || 0;
    const safeMedian = Number(medianPrice) || 0;
    const safeTop = Number(topPrice) || 0;

    const againstMedianAmount = Math.round(safePrice - safeMedian);
    const againstMedianPercentage = safeMedian > 0
        ? Number(((againstMedianAmount / safeMedian) * 100).toFixed(1))
        : 0;

    const againstTopAmount = Math.round(safePrice - safeTop);
    const againstTopPercentage = safeTop > 0
        ? Number(((againstTopAmount / safeTop) * 100).toFixed(1))
        : 0;

    const position = Math.abs(againstMedianPercentage) <= 4
        ? 'near'
        : (againstMedianAmount < 0 ? 'below' : 'above');

    return {
        medianPrice: safeMedian,
        againstMedianAmount,
        againstMedianPercentage,
        againstTopAmount,
        againstTopPercentage,
        position,
    };
};

const buildAuthenticityHints = ({ product, dealDna, priceGap }) => {
    const positiveSignals = [];
    const warningSignals = [];
    const ratingCount = Number(product.ratingCount) || 0;
    const warrantyText = sanitizeText(product.warranty || '');
    const discountPercentage = Number(product.discountPercentage) || 0;
    const imageCount = Array.isArray(product.images)
        ? product.images.length
        : (Array.isArray(product.image) ? product.image.length : (product.image ? 1 : 0));

    if (ratingCount >= 200) positiveSignals.push('Strong review history');
    else if (ratingCount < 40) warningSignals.push('Low review confidence');

    if (warrantyText) positiveSignals.push('Warranty information present');
    else warningSignals.push('Warranty information missing');

    if (imageCount >= 2) positiveSignals.push('Multiple catalog images available');
    else warningSignals.push('Limited image evidence');

    if (discountPercentage >= 75) warningSignals.push('Extreme discount anomaly');
    if (priceGap.position === 'below' && Math.abs(priceGap.againstMedianPercentage) >= 45) {
        warningSignals.push('Price is far below similar matches');
    }

    const returnRisk = dealDna?.returnRisk || { score: 50, tier: 'medium', reasons: [] };
    const score = clampNumber(
        Math.round(100 - returnRisk.score + (positiveSignals.length * 4) - (warningSignals.length * 6)),
        8,
        98
    );

    let verdict = 'verify';
    if (returnRisk.tier === 'low' && warningSignals.length <= 1) verdict = 'likely_authentic';
    if (returnRisk.tier === 'high' || warningSignals.length >= 3) verdict = 'high_risk';

    const summary = verdict === 'likely_authentic'
        ? 'Metadata and pricing signals look consistent.'
        : verdict === 'high_risk'
            ? 'Multiple risk markers detected. Verify seller and specs.'
            : 'Mixed trust signals. Check warranty, reviews, and listing details.';

    return {
        verdict,
        score,
        summary,
        positiveSignals: positiveSignals.slice(0, 3),
        warningSignals: warningSignals.slice(0, 3),
        returnRisk,
    };
};

// @desc    Visual search products via image hints
// @route   POST /api/products/visual-search
// @access  Public
const visualSearchProducts = asyncHandler(async (req, res, next) => {
    try {
        const limit = Number(req.body.limit) || 12;
        const tokens = buildVisualTokens(req.body);
        const keyword = tokens.length > 0 ? tokens.slice(0, 3).join(' ') : '';

        const result = await queryProducts({
            keyword,
            sort: 'relevance',
            page: 1,
            limit,
        });

        const scoredProducts = (result.products || []).map((product) => ({
            ...product.toObject?.() || product,
            visualConfidence: getVisualConfidence(product, tokens),
        })).sort((a, b) => b.visualConfidence - a.visualConfidence);

        const priceStats = computePriceStats(scoredProducts);
        const topPrice = Number(scoredProducts[0]?.price) || 0;
        const enrichedProducts = scoredProducts.map((product) => {
            const dealDna = computeDealDna(product);
            const priceGap = buildPriceGap({
                price: product.price,
                medianPrice: priceStats.median,
                topPrice,
            });
            return {
                ...product,
                dealDna,
                priceGap,
                authenticityHints: buildAuthenticityHints({
                    product,
                    dealDna,
                    priceGap,
                }),
            };
        });

        res.json({
            querySignals: {
                tokens,
                derivedKeyword: keyword || null,
                imageMeta: req.body.imageMeta || null,
            },
            marketSnapshot: {
                topMatchPrice: topPrice,
                medianMatchPrice: priceStats.median,
                minMatchPrice: priceStats.min,
                maxMatchPrice: priceStats.max,
                sampleSize: priceStats.count,
            },
            total: result.total || enrichedProducts.length,
            matches: enrichedProducts,
        });
    } catch (error) {
        if (error instanceof AppError) return next(error);
        logger.error('products.visual_search_failed', {
            error: error.message,
            requestId: req.requestId,
        });
        return next(new AppError('Failed to run visual search', 500));
    }
});

module.exports = {
    getProducts,
    getProductDealDna,
    getProductCompatibility,
    getProductReviews,
    createProductReview,
    buildProductBundle,
    visualSearchProducts,
    getProductById,
    deleteProduct,
    createProduct,
    updateProduct
};
