const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const { saveAuthProfileSnapshot } = require('../services/authProfileVault');
const { awardLoyaltyPoints, getUserRewards, getRewardSnapshotFromUser } = require('../services/loyaltyService');
const { invalidateUserCache, invalidateUserCacheByEmail } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { buildProductImageDeliveryUrl } = require('../services/productImageResolver');

const PROFILE_PROJECTION = 'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation addresses cart wishlist loyalty createdAt';
const AUTH_ONLY_PROJECTION = 'name email phone isAdmin isVerified isSeller sellerActivatedAt accountState moderation loyalty';

const PHONE_REGEX = /^\+?\d{10,15}$/;

const normalizePhone = (value) => (
    typeof value === 'string' ? value.trim().replace(/[\s\-()]/g, '') : ''
);

const normalizeText = (value) => (
    typeof value === 'string' ? value.trim() : ''
);

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const normalizeCartItemPayload = (item = {}) => {
    const normalizedId = Number(item.id);
    const normalizedPrice = Number(item.price || 0);
    const normalizedOriginalPrice = Number(item.originalPrice || item.price || 0);
    return {
        id: Number.isFinite(normalizedId) ? normalizedId : 0,
        title: normalizeText(item.title) || '',
        price: Number.isFinite(normalizedPrice) ? normalizedPrice : 0,
        image: normalizeText(item.image) || '',
        quantity: Math.max(1, Number(item.quantity || 1)),
        stock: Math.max(0, Number(item.stock || 0)),
        brand: normalizeText(item.brand) || '',
        discountPercentage: Number(item.discountPercentage || 0),
        originalPrice: Number.isFinite(normalizedOriginalPrice) ? normalizedOriginalPrice : 0,
    };
};

const hydrateCartWithLiveProducts = async (cartItems = []) => {
    if (!Array.isArray(cartItems) || cartItems.length === 0) return [];

    const normalizedItems = cartItems
        .map((item) => normalizeCartItemPayload(item))
        .filter((item) => Number.isFinite(item.id) && item.id > 0);

    if (normalizedItems.length === 0) return [];

    const itemIds = [...new Set(normalizedItems.map((item) => Number(item.id)))];
    const liveProducts = await Product.find({ id: { $in: itemIds } })
        .select('id title price image stock brand discountPercentage originalPrice')
        .lean();

    const productById = new Map(
        (liveProducts || []).map((product) => [Number(product.id), product])
    );

    return normalizedItems.map((item) => {
        const live = productById.get(Number(item.id));
        if (!live) return item;

        const liveStock = Math.max(0, Number(live.stock || 0));
        const requestedQty = Math.max(1, Number(item.quantity || 1));

        return {
            ...item,
            title: normalizeText(live.title) || item.title,
            price: Number(live.price ?? item.price ?? 0),
            image: buildProductImageDeliveryUrl(normalizeText(live.image) || item.image),
            stock: liveStock,
            brand: normalizeText(live.brand) || item.brand,
            discountPercentage: Number(live.discountPercentage ?? item.discountPercentage ?? 0),
            originalPrice: Number(live.originalPrice ?? item.originalPrice ?? live.price ?? item.price ?? 0),
            quantity: liveStock > 0 ? Math.min(requestedQty, liveStock) : requestedQty,
        };
    });
};

const getDuplicateField = (error) => {
    if (!error || error.code !== 11000) return null;
    if (error.keyPattern?.email) return 'email';
    if (error.keyPattern?.phone) return 'phone';
    return null;
};

const buildUserBootstrapPayload = ({ email, authUser = {} }) => {
    const safeEmail = normalizeEmail(email || authUser.email);
    const safeName = normalizeText(authUser.name) || safeEmail.split('@')[0] || 'Aura User';
    const rawPhone = normalizePhone(authUser.phone || '');
    const safePhone = PHONE_REGEX.test(rawPhone) ? rawPhone : '';

    const setOnInsert = {
        email: safeEmail,
        name: safeName,
        isVerified: Boolean(authUser.isVerified),
    };

    if (safePhone) {
        setOnInsert.phone = safePhone;
    }

    return { safeEmail, setOnInsert };
};

const bootstrapUserRecord = async ({ email, authUser = {}, projection = PROFILE_PROJECTION, lean = true }) => {
    const { safeEmail, setOnInsert } = buildUserBootstrapPayload({ email, authUser });
    if (!safeEmail) return null;

    const queryOptions = {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        projection,
        ...(lean ? { lean: true } : {}),
    };

    try {
        return await User.findOneAndUpdate(
            { email: safeEmail },
            { $setOnInsert: setOnInsert },
            queryOptions
        );
    } catch (error) {
        if (getDuplicateField(error) !== 'phone') {
            throw error;
        }
        const { phone, ...withoutPhone } = setOnInsert;
        return User.findOneAndUpdate(
            { email: safeEmail },
            { $setOnInsert: withoutPhone },
            queryOptions
        );
    }
};

const ensureUserLean = async ({ email, authUser = {}, projection = PROFILE_PROJECTION }) => {
    const safeEmail = normalizeEmail(email || authUser.email);
    if (!safeEmail) return null;

    const existing = await User.findOne({ email: safeEmail }, projection).lean();
    if (existing) return existing;

    return bootstrapUserRecord({
        email: safeEmail,
        authUser,
        projection,
        lean: true,
    });
};

const ensureUserDocument = async ({ email, authUser = {} }) => {
    const safeEmail = normalizeEmail(email || authUser.email);
    if (!safeEmail) return null;

    let user = await User.findOne({ email: safeEmail });
    if (user) return user;

    await bootstrapUserRecord({
        email: safeEmail,
        authUser,
        projection: '_id',
        lean: true,
    });

    user = await User.findOne({ email: safeEmail });
    return user;
};

const persistAuthSnapshot = async (user) => {
    if (!user?.email) return;
    await saveAuthProfileSnapshot({
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar || '',
        gender: user.gender || '',
        dob: user.dob || null,
        bio: user.bio || '',
        isVerified: Boolean(user.isVerified),
        isAdmin: Boolean(user.isAdmin),
        isSeller: Boolean(user.isSeller),
    });
};

// @desc    Authenticated user sync after Firebase login
// @route   POST /api/users/login
// @access  Private (requires Firebase token via protect middleware)
const loginUser = asyncHandler(async (req, res, next) => {
    const { name, phone, email: bodyEmail } = req.body;
    const tokenEmail = normalizeEmail(req.user?.email);
    const requestEmail = normalizeEmail(bodyEmail);

    const normalizedName = normalizeText(name);
    const hasPhoneInput = phone !== undefined && phone !== null && String(phone).trim() !== '';
    const emailVerified = Boolean(req.authToken?.email_verified);

    if (!tokenEmail) {
        return next(new AppError('Email is required', 400));
    }
    if (requestEmail && requestEmail !== tokenEmail) {
        return next(new AppError('Email in request does not match authenticated account', 400));
    }
    if (!emailVerified) {
        return next(new AppError('Email verification is required before login sync', 403));
    }

    let normalizedPhone = '';
    if (hasPhoneInput) {
        if (typeof phone !== 'string') {
            return next(new AppError('Phone number must be a string', 400));
        }
        normalizedPhone = normalizePhone(phone);
        if (!PHONE_REGEX.test(normalizedPhone)) {
            return next(new AppError('Valid phone number is required', 400));
        }
    }

    let user;
    try {
        const fallbackName = normalizedName || normalizeText(req.user?.name) || tokenEmail.split('@')[0] || 'Aura User';
        const setPayload = {
            name: fallbackName,
            isVerified: emailVerified,
        };
        if (hasPhoneInput) {
            setPayload.phone = normalizedPhone;
        }

        user = await User.findOneAndUpdate(
            { email: tokenEmail },
            { $set: setPayload, $setOnInsert: { email: tokenEmail } },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true,
                projection: AUTH_ONLY_PROJECTION,
                lean: true,
            }
        );
    } catch (error) {
        if (getDuplicateField(error) === 'phone') {
            return next(new AppError('Phone number is already linked to another account', 409));
        }
        throw error;
    }

    if (!user) {
        return next(new AppError('Unable to initialize user profile', 500));
    }

    try {
        await awardLoyaltyPoints({
            userId: user._id,
            action: 'daily_login',
        });
        user = await User.findById(user._id, AUTH_ONLY_PROJECTION).lean();
    } catch (rewardError) {
        logger.warn('loyalty.daily_login_award_failed', {
            email: tokenEmail,
            userId: String(user._id || ''),
            error: rewardError.message,
        });
    }

    await persistAuthSnapshot(user);
    invalidateUserCache(req.authUid);
    invalidateUserCacheByEmail(user.email);

    res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isAdmin: user.isAdmin,
        isVerified: user.isVerified,
        isSeller: Boolean(user.isSeller),
        sellerActivatedAt: user.sellerActivatedAt || null,
        accountState: user.accountState || 'active',
        moderation: user.moderation || {},
        loyalty: getRewardSnapshotFromUser(user),
    });
});

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res, next) => {
    const email = req.user?.email;

    if (!email) {
        return next(new AppError('Not authorized', 401));
    }

    const user = await ensureUserLean({
        email,
        authUser: req.user,
        projection: PROFILE_PROJECTION,
    });

    if (!user) {
        return next(new AppError('Unable to recover user profile', 500));
    }

    const hydratedCart = await hydrateCartWithLiveProducts(user.cart || []);
    if (JSON.stringify(hydratedCart) !== JSON.stringify(user.cart || [])) {
        await User.updateOne({ _id: user._id }, { $set: { cart: hydratedCart } });
    }

    await persistAuthSnapshot(user);

    res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar || '',
        gender: user.gender || '',
        dob: user.dob || null,
        bio: user.bio || '',
        isAdmin: user.isAdmin,
        isVerified: user.isVerified,
        isSeller: Boolean(user.isSeller),
        sellerActivatedAt: user.sellerActivatedAt || null,
        accountState: user.accountState || 'active',
        moderation: user.moderation || {},
        addresses: user.addresses || [],
        cart: hydratedCart,
        wishlist: user.wishlist,
        loyalty: getRewardSnapshotFromUser(user),
        createdAt: user.createdAt,
    });
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = asyncHandler(async (req, res, next) => {
    const updates = req.body || {};
    const allowedFields = ['name', 'avatar', 'gender', 'dob', 'bio', 'phone'];
    const blockedFields = Object.keys(updates).filter((key) => !allowedFields.includes(key));

    if (blockedFields.length > 0) {
        return next(new AppError(`Unsupported profile fields: ${blockedFields.join(', ')}`, 400));
    }

    if (Object.keys(updates).length === 0) {
        return next(new AppError('No fields to update', 400));
    }

    if (updates.phone !== undefined) {
        if (typeof updates.phone !== 'string') {
            return next(new AppError('Phone number must be a string', 400));
        }
        const normalizedPhone = normalizePhone(updates.phone);
        if (normalizedPhone && !PHONE_REGEX.test(normalizedPhone)) {
            return next(new AppError('Valid phone number is required', 400));
        }
        updates.phone = normalizedPhone || undefined;
        if (!updates.phone) {
            delete updates.phone;
        }
    }

    let user;
    try {
        user = await User.findOneAndUpdate(
            { email: req.user.email },
            { $set: updates },
            { new: true, projection: PROFILE_PROJECTION, lean: true }
        );
    } catch (error) {
        if (getDuplicateField(error) === 'phone') {
            return next(new AppError('Phone number is already linked to another account', 409));
        }
        throw error;
    }

    if (!user) {
        return next(new AppError('User not found', 404));
    }

    await persistAuthSnapshot(user);
    invalidateUserCache(req.authUid);
    invalidateUserCacheByEmail(user.email);

    res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar || '',
        gender: user.gender || '',
        dob: user.dob || null,
        bio: user.bio || '',
        isAdmin: user.isAdmin,
        isVerified: user.isVerified,
        isSeller: Boolean(user.isSeller),
        sellerActivatedAt: user.sellerActivatedAt || null,
        accountState: user.accountState || 'active',
        moderation: user.moderation || {},
        addresses: user.addresses || [],
        loyalty: getRewardSnapshotFromUser(user),
        createdAt: user.createdAt,
    });
});

// @desc    Get profile dashboard (stats + recent orders + listings count)
// @route   GET /api/users/dashboard
// @access  Private
const getProfileDashboard = asyncHandler(async (req, res, next) => {
    const email = req.user?.email;
    if (!email) return next(new AppError('Not authorized', 401));

    const user = await ensureUserLean({
        email,
        authUser: req.user,
        projection: '_id loyalty',
    });
    if (!user) return next(new AppError('Unable to recover user profile', 500));

    const [orders, listingStats] = await Promise.all([
        Order.find({ user: user._id })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
        Listing.aggregate([
            { $match: { seller: user._id } },
            { $group: { _id: '$status', count: { $sum: 1 }, totalViews: { $sum: '$views' } } }
        ])
    ]);

    const totalOrders = await Order.countDocuments({ user: user._id });
    const totalSpent = orders.length > 0
        ? (await Order.aggregate([
            { $match: { user: user._id } },
            { $group: { _id: null, total: { $sum: '$totalPrice' } } }
        ]))[0]?.total || 0
        : 0;

    const listings = { active: 0, sold: 0, totalViews: 0 };
    listingStats.forEach((s) => {
        if (s._id === 'active') {
            listings.active = s.count;
            listings.totalViews += s.totalViews;
        }
        if (s._id === 'sold') {
            listings.sold = s.count;
        }
    });

    res.json({
        success: true,
        stats: {
            totalOrders,
            totalSpent,
            wishlistCount: 0,
            cartCount: 0,
            listings,
            rewards: getRewardSnapshotFromUser(user),
        },
        recentOrders: orders.slice(0, 5)
    });
});

// @desc    Get loyalty rewards snapshot + activity
// @route   GET /api/users/rewards
// @access  Private
const getRewards = asyncHandler(async (req, res, next) => {
    const email = req.user?.email;
    if (!email) return next(new AppError('Not authorized', 401));

    const user = await ensureUserLean({
        email,
        authUser: req.user,
        projection: '_id',
    });
    if (!user) return next(new AppError('Unable to recover user profile', 500));

    const rewards = await getUserRewards({ userId: user._id, limit: 30 });
    res.json({ success: true, rewards });
});

// @desc    Add address
// @route   POST /api/users/addresses
// @access  Private
const addAddress = asyncHandler(async (req, res, next) => {
    const { type, name, phone, address, city, state, pincode, isDefault } = req.body;

    const user = await ensureUserDocument({
        email: req.user.email,
        authUser: req.user,
    });
    if (!user) return next(new AppError('Unable to recover user profile', 500));

    if (isDefault) {
        user.addresses.forEach((a) => { a.isDefault = false; });
    }

    const makeDefault = user.addresses.length === 0 ? true : Boolean(isDefault);

    user.addresses.push({
        type,
        name,
        phone: phone ? phone.replace(/\D/g, '') : phone,
        address,
        city,
        state,
        pincode,
        isDefault: makeDefault
    });

    await user.save();
    res.status(201).json({ success: true, addresses: user.addresses });
});



// @desc    Update address
// @route   PUT /api/users/addresses/:addressId
// @access  Private
const updateAddress = asyncHandler(async (req, res, next) => {
    const user = await ensureUserDocument({
        email: req.user.email,
        authUser: req.user,
    });
    if (!user) return next(new AppError('Unable to recover user profile', 500));

    const addr = user.addresses.id(req.params.addressId);
    if (!addr) return next(new AppError('Address not found', 404));

    const incoming = req.body; // Fully validated by Zod

    if (Object.keys(incoming).length === 0) {
        return next(new AppError('No address fields to update', 400));
    }

    if (incoming.phone) {
        incoming.phone = incoming.phone.replace(/\D/g, '');
    }

    const { isDefault, ...fieldsToUpdate } = incoming;

    if (isDefault === true) {
        user.addresses.forEach((a) => { a.isDefault = false; });
        addr.isDefault = true;
    } else if (isDefault === false && addr.isDefault) {
        // If unsetting default, make another one default if it exists
        if (user.addresses.length > 1) {
            const anotherAddr = user.addresses.find(a => String(a._id) !== String(addr._id));
            if (anotherAddr) anotherAddr.isDefault = true;
        }
        addr.isDefault = false;
    }

    Object.assign(addr, fieldsToUpdate);
    await user.save();
    res.json({ success: true, addresses: user.addresses });
});

// @desc    Delete address
// @route   DELETE /api/users/addresses/:addressId
// @access  Private
const deleteAddress = asyncHandler(async (req, res, next) => {
    const user = await ensureUserDocument({
        email: req.user.email,
        authUser: req.user,
    });
    if (!user) return next(new AppError('Unable to recover user profile', 500));

    const addr = user.addresses.id(req.params.addressId);
    if (!addr) return next(new AppError('Address not found', 404));

    const wasDefault = addr.isDefault;
    user.addresses.pull(req.params.addressId);

    if (wasDefault && user.addresses.length > 0) {
        user.addresses[0].isDefault = true;
    }

    await user.save();
    res.json({ success: true, addresses: user.addresses });
});

// @desc    Sync Cart
// @route   PUT /api/users/cart
// @access  Private
const syncCart = asyncHandler(async (req, res, next) => {
    const { cartItems } = req.body;

    if (!Array.isArray(cartItems)) {
        return next(new AppError('cartItems must be an array', 400));
    }

    const safeEmail = normalizeEmail(req.user?.email);
    if (!safeEmail) {
        return next(new AppError('Not authorized', 401));
    }

    const hydratedCart = await hydrateCartWithLiveProducts(cartItems);

    let user = await User.findOneAndUpdate(
        { email: safeEmail },
        { $set: { cart: hydratedCart } },
        { new: true, projection: 'cart', lean: true }
    );

    if (!user) {
        await bootstrapUserRecord({
            email: safeEmail,
            authUser: req.user,
            projection: '_id',
            lean: true,
        });
        user = await User.findOneAndUpdate(
            { email: safeEmail },
            { $set: { cart: hydratedCart } },
            { new: true, projection: 'cart', lean: true }
        );
    }

    if (!user) {
        return next(new AppError('Unable to recover user profile', 500));
    }

    res.json(user.cart);
});

// @desc    Sync Wishlist
// @route   PUT /api/users/wishlist
// @access  Private
const syncWishlist = asyncHandler(async (req, res, next) => {
    const { wishlistItems } = req.body;

    if (!Array.isArray(wishlistItems)) {
        return next(new AppError('wishlistItems must be an array', 400));
    }

    const safeEmail = normalizeEmail(req.user?.email);
    if (!safeEmail) {
        return next(new AppError('Not authorized', 401));
    }

    let user = await User.findOneAndUpdate(
        { email: safeEmail },
        { $set: { wishlist: wishlistItems } },
        { new: true, projection: 'wishlist', lean: true }
    );

    if (!user) {
        await bootstrapUserRecord({
            email: safeEmail,
            authUser: req.user,
            projection: '_id',
            lean: true,
        });
        user = await User.findOneAndUpdate(
            { email: safeEmail },
            { $set: { wishlist: wishlistItems } },
            { new: true, projection: 'wishlist', lean: true }
        );
    }

    if (!user) {
        return next(new AppError('Unable to recover user profile', 500));
    }

    res.json(user.wishlist);
});

// @desc    Activate seller mode for current user
// @route   POST /api/users/seller/activate
// @access  Private
const activateSellerAccount = asyncHandler(async (req, res, next) => {
    const safeEmail = normalizeEmail(req.user?.email);
    if (!safeEmail) {
        return next(new AppError('Not authorized', 401));
    }

    const acceptTerms = req.body?.acceptTerms;
    if (acceptTerms !== true) {
        return next(new AppError('Seller terms must be accepted to activate seller mode', 400));
    }

    const user = await ensureUserDocument({
        email: safeEmail,
        authUser: req.user,
    });

    if (!user) {
        return next(new AppError('Unable to recover user profile', 500));
    }

    if (!user.isVerified) {
        return next(new AppError('Account verification required before seller activation', 403));
    }

    const normalizedPhone = normalizePhone(user.phone || '');
    if (!PHONE_REGEX.test(normalizedPhone)) {
        return next(new AppError('Valid phone number required before seller activation', 400));
    }

    if (!user.isSeller) {
        user.isSeller = true;
        user.sellerActivatedAt = new Date();
        await user.save();
    }

    await persistAuthSnapshot(user);
    invalidateUserCache(req.authUid);
    invalidateUserCacheByEmail(user.email);

    return res.json({
        success: true,
        message: 'Seller mode activated',
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            isAdmin: Boolean(user.isAdmin),
            isVerified: Boolean(user.isVerified),
            isSeller: Boolean(user.isSeller),
            sellerActivatedAt: user.sellerActivatedAt || null,
            loyalty: getRewardSnapshotFromUser(user),
            createdAt: user.createdAt,
        },
    });
});

// @desc    Deactivate seller mode for current user
// @route   POST /api/users/seller/deactivate
// @access  Private
const deactivateSellerAccount = asyncHandler(async (req, res, next) => {
    const safeEmail = normalizeEmail(req.user?.email);
    if (!safeEmail) {
        return next(new AppError('Not authorized', 401));
    }

    const confirmDeactivation = req.body?.confirmDeactivation;
    if (confirmDeactivation !== true) {
        return next(new AppError('confirmDeactivation must be true to continue', 400));
    }

    const user = await ensureUserDocument({
        email: safeEmail,
        authUser: req.user,
    });

    if (!user) {
        return next(new AppError('Unable to recover user profile', 500));
    }

    if (!user.isSeller) {
        return res.json({
            success: true,
            message: 'Seller mode is already inactive',
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                isAdmin: Boolean(user.isAdmin),
                isVerified: Boolean(user.isVerified),
                isSeller: false,
                sellerActivatedAt: null,
                loyalty: getRewardSnapshotFromUser(user),
                createdAt: user.createdAt,
            },
        });
    }

    const activeListingCount = await Listing.countDocuments({
        seller: user._id,
        status: 'active',
    });

    if (activeListingCount > 0) {
        return next(new AppError(
            `Cannot deactivate seller mode while ${activeListingCount} active listing(s) exist. Mark them sold or delete them first.`,
            409
        ));
    }

    user.isSeller = false;
    user.sellerActivatedAt = null;
    await user.save();

    await persistAuthSnapshot(user);
    invalidateUserCache(req.authUid);
    invalidateUserCacheByEmail(user.email);

    return res.json({
        success: true,
        message: 'Seller mode deactivated',
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            isAdmin: Boolean(user.isAdmin),
            isVerified: Boolean(user.isVerified),
            isSeller: false,
            sellerActivatedAt: null,
            loyalty: getRewardSnapshotFromUser(user),
            createdAt: user.createdAt,
        },
    });
});

module.exports = {
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
};
