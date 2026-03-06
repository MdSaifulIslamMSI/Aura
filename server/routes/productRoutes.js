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
    getProductById,
    deleteProduct,
    createProduct,
    updateProduct
} = require('../controllers/productController');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
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
    getProductByIdSchema
} = require('../validators/productValidators');

// Public Routes
router.route('/')
    .get(validate(productSearchSchema), getProducts)
    .post(protect, admin, validate(createProductSchema), createProduct);

router.route('/recommendations')
    .post(protect, validate(productRecommendationSchema), getRecommendedProducts);

router.route('/visual-search')
    .post(validate(visualSearchSchema), visualSearchProducts);

router.route('/bundles/build')
    .post(validate(bundleBuildSchema), buildProductBundle);

router.route('/:id/deal-dna')
    .get(validate(getProductDealDnaSchema), getProductDealDna);

router.route('/:id/compatibility')
    .get(validate(getProductCompatibilitySchema), getProductCompatibility);

router.route('/:id/reviews')
    .get(validate(getProductReviewsSchema), getProductReviews)
    .post(protect, validate(createProductReviewSchema), createProductReview);

router.route('/:id')
    .get(validate(getProductByIdSchema), getProductById)
    .delete(protect, admin, validate(deleteProductSchema), deleteProduct)
    .put(protect, admin, validate(updateProductSchema), updateProduct);

module.exports = router;
