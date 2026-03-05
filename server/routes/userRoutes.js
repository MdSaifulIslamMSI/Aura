const express = require('express');
const router = express.Router();
const {
    loginUser,
    getUserProfile,
    syncCart,
    syncWishlist,
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
router.post('/seller/activate', protect, validate(activateSellerSchema), activateSellerAccount); // Protected
router.post('/seller/deactivate', protect, validate(deactivateSellerSchema), deactivateSellerAccount); // Protected
// Backward-compat aliases for older frontend builds.
router.post('/activate-seller', protect, validate(activateSellerSchema), activateSellerAccount);
router.post('/seller/enable', protect, validate(activateSellerSchema), activateSellerAccount);
router.post('/deactivate-seller', protect, validate(deactivateSellerSchema), deactivateSellerAccount);
router.post('/seller/disable', protect, validate(deactivateSellerSchema), deactivateSellerAccount);

// Address CRUD
router.post('/addresses', protect, validate(addressSchema), addAddress);
router.put('/addresses/:addressId', protect, validate(addressSchema), updateAddress);
router.delete('/addresses/:addressId', protect, deleteAddress);

router.put('/cart', protect, syncCart); // Protected
router.put('/wishlist', protect, syncWishlist); // Protected

module.exports = router;
