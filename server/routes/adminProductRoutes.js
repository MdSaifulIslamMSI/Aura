const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    listAdminProducts,
    getAdminProductById,
    createAdminProduct,
    updateAdminProductCore,
    updateAdminProductPricing,
    deleteAdminProduct,
    getAdminProductLogs,
} = require('../controllers/adminProductController');
const {
    adminProductListSchema,
    adminProductDetailSchema,
    adminCreateProductSchema,
    adminUpdateProductCoreSchema,
    adminUpdateProductPricingSchema,
    adminDeleteProductSchema,
} = require('../validators/adminProductValidators');

const router = express.Router();

// Admin product control data must always be fresh; do not serve from browser/intermediate caches.
router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

router.get('/', protect, admin, validate(adminProductListSchema), listAdminProducts);
router.post('/', protect, admin, validate(adminCreateProductSchema), createAdminProduct);
router.get('/:id/logs', protect, admin, validate(adminProductDetailSchema), getAdminProductLogs);
router.get('/:id', protect, admin, validate(adminProductDetailSchema), getAdminProductById);
router.patch('/:id/core', protect, admin, validate(adminUpdateProductCoreSchema), updateAdminProductCore);
router.patch('/:id/pricing', protect, admin, validate(adminUpdateProductPricingSchema), updateAdminProductPricing);
router.delete('/:id', protect, admin, validate(adminDeleteProductSchema), deleteAdminProduct);

module.exports = router;
