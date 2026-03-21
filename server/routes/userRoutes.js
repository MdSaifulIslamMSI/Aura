const express = require('express');
const router = express.Router();
const {
    loginUser,
    getUserProfile,
    getCart,
    syncCart,
    addCartItem,
    setCartItemQuantity,
    removeCartItem,
    mergeCart,
    getWishlist,
    syncWishlist,
    addWishlistItem,
    removeWishlistItem,
    mergeWishlist,
    updateUserProfile,
    getProfileDashboard,
    getRewards,
    addAddress,
    updateAddress,
    deleteAddress,
    activateSellerAccount,
    deactivateSellerAccount,
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    loginSchema,
    updateProfileSchema,
    addressSchema,
    activateSellerSchema,
    deactivateSellerSchema,
} = require('../validators/userValidators');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');

const loginLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'user_login',
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 600 : 200,
    message: 'Too many account sync requests, please try again after 15 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${req.user.email.trim().toLowerCase()}`;
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return email || req.ip;
    },
});

router.post('/login', protect, loginLimiter, validate(loginSchema), loginUser); // Protected: requires Firebase token

router
    .route('/profile')
    .get(protect, getUserProfile) // Protected
    .put(protect, validate(updateProfileSchema), updateUserProfile); // Protected

router.get('/dashboard', protect, getProfileDashboard); // Protected
router.get('/rewards', protect, getRewards); // Protected
// Seller account CRUD — canonical routes only.
// Backward-compat aliases (/activate-seller, /seller/enable, etc.) were
// removed. Clients should use /seller/activate and /seller/deactivate.
router.post('/seller/activate', protect, validate(activateSellerSchema), activateSellerAccount);
router.post('/seller/deactivate', protect, validate(deactivateSellerSchema), deactivateSellerAccount);


// Address CRUD
router.post('/addresses', protect, validate(addressSchema), addAddress);
router.put('/addresses/:addressId', protect, validate(addressSchema), updateAddress);
router.delete('/addresses/:addressId', protect, deleteAddress);

router.get('/cart', protect, getCart); // Protected
router.put('/cart', protect, syncCart); // Protected legacy full replacement
router.post('/cart/merge', protect, mergeCart); // Protected
router.post('/cart/items', protect, addCartItem); // Protected
router.patch('/cart/items/:productId', protect, setCartItemQuantity); // Protected
router.delete('/cart/items/:productId', protect, removeCartItem); // Protected
router.get('/wishlist', protect, getWishlist); // Protected
router.put('/wishlist', protect, syncWishlist); // Protected
router.post('/wishlist/merge', protect, mergeWishlist); // Protected
router.post('/wishlist/items', protect, addWishlistItem); // Protected
router.delete('/wishlist/items/:productId', protect, removeWishlistItem); // Protected

module.exports = router;
