const express = require('express');
const router = express.Router();
const {
    getProducts,
    getRecommendedProducts,
    getProductDealDna,
    getProductCompatibility,
    getProductReviews,
    createProductReview,
    buildProductBundle,
    visualSearchProducts,
    trackProductSearchClick,
    getCatalogArtwork,
    getProductImageProxy,
    getProductById,
    deleteProduct,
    createProduct,
    updateProduct
} = require('../controllers/productController');
const { protect, admin, requireActiveAccount } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const {
    productSearchSchema,
    productRecommendationSchema,
    visualSearchSchema,
    bundleBuildSchema,
    getProductDealDnaSchema,
    getProductCompatibilitySchema,
    getProductReviewsSchema,
    createProductReviewSchema,
    createProductSchema,
    updateProductSchema,
    deleteProductSchema,
    getProductByIdSchema,
    trackSearchClickSchema,
} = require('../validators/productValidators');

// Public route with an unindexed text filter and a knapsack solve: throttle by
// actor/IP so one caller cannot force repeated collection scans.
const bundleBuildLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'product_bundle_build',
    securityCritical: true,
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip || req.socket?.remoteAddress || 'unknown',
    message: {
        success: false,
        code: 'BUNDLE_BUILD_RATE_LIMITED',
        message: 'Too many bundle requests. Please wait before trying again.',
    },
});

// Public Routes
router.route('/')
    .get(validate(productSearchSchema), getProducts)
    .post(protect, admin, validate(createProductSchema), sensitiveActions.adminProductChange, createProduct);

router.route('/recommendations')
    .post(protect, validate(productRecommendationSchema), getRecommendedProducts);

router.route('/visual-search')
    .post(protect, requireActiveAccount, validate(visualSearchSchema), visualSearchProducts);

router.route('/bundles/build')
    .post(bundleBuildLimiter, validate(bundleBuildSchema), buildProductBundle);

router.route('/telemetry/search-click')
    .post(validate(trackSearchClickSchema), trackProductSearchClick);

router.route('/image-proxy')
    .get(getProductImageProxy);

router.route('/art/:externalId.svg')
    .get(getCatalogArtwork);

router.route('/:id/deal-dna')
    .get(validate(getProductDealDnaSchema), getProductDealDna);

router.route('/:id/compatibility')
    .get(validate(getProductCompatibilitySchema), getProductCompatibility);

router.route('/:id/reviews')
    .get(validate(getProductReviewsSchema), getProductReviews)
    .post(protect, requireActiveAccount, validate(createProductReviewSchema), sensitiveActions.moderationAction, createProductReview);

router.route('/:id')
    .get(validate(getProductByIdSchema), getProductById)
    .delete(protect, admin, validate(deleteProductSchema), sensitiveActions.adminProductChange, deleteProduct)
    .put(protect, admin, validate(updateProductSchema), sensitiveActions.adminProductChange, updateProduct);

module.exports = router;
