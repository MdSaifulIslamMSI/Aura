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
const { buildDisplayPair } = require('../services/markets/marketPricing');
const {
    getCartSnapshot: getDedicatedCartSnapshot,
    buildLegacyCartResponse: buildDedicatedLegacyCartResponse,
} = require('../services/cartService');

const PROFILE_PROJECTION = 'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation addresses wishlist wishlistRevision wishlistSyncedAt loyalty createdAt';
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

const toPlainObject = (value = {}) => {
    if (!value || typeof value !== 'object') return {};
    if (typeof value.toObject === 'function') {
        return value.toObject();
    }
    if (value._doc && typeof value._doc === 'object') {
        return value._doc;
    }
    return value;
};

const hydrateWishlistWithLiveProducts = async (wishlistItems = []) => {
    if (!Array.isArray(wishlistItems) || wishlistItems.length === 0) return [];

    const normalizedItems = wishlistItems
        .map((item) => normalizeWishlistItemPayload(item))
        .filter((item) => Number.isFinite(item.id) && item.id > 0);

    if (normalizedItems.length === 0) return [];

    const itemIds = [...new Set(normalizedItems.map((item) => Number(item.id)))];
    const liveProducts = await Product.find({ id: { $in: itemIds } })
        .select('id title price originalPrice discountPercentage image stock brand rating ratingCount deliveryTime category')
        .lean();

    const productById = new Map(
        (liveProducts || []).map((product) => [Number(product.id), product])
    );

    return normalizedItems.map((item) => {
        const live = productById.get(Number(item.id));
        if (!live) return item;

        return {
            ...item,
            title: normalizeText(live.title) || item.title,
            price: Number(live.price ?? item.price ?? 0),
            originalPrice: Number(live.originalPrice ?? item.originalPrice ?? live.price ?? item.price ?? 0),
            discountPercentage: Number(live.discountPercentage ?? item.discountPercentage ?? 0),
            image: buildProductImageDeliveryUrl(normalizeText(live.image) || item.image),
            brand: normalizeText(live.brand) || item.brand,
            rating: Number(live.rating ?? item.rating ?? 0),
            ratingCount: Math.max(0, Number(live.ratingCount ?? item.ratingCount ?? 0)),
            stock: Math.max(0, Number(live.stock ?? item.stock ?? 0)),
            deliveryTime: normalizeText(live.deliveryTime) || item.deliveryTime,
            category: normalizeText(live.category) || item.category,
        };
    });
};

const wishlistSnapshotsEqual = (left = [], right = []) => JSON.stringify(left || []) === JSON.stringify(right || []);

const attachMarketPricingToLine = async (item = {}, market = null) => {
    const plainItem = toPlainObject(item);
    if (!market) return plainItem;

    const pricing = await buildDisplayPair({
        amount: Number(plainItem?.price || 0),
        originalAmount: Number(plainItem?.originalPrice || plainItem?.price || 0),
        baseCurrency: market.baseCurrency,
        market,
    });

    return {
        ...plainItem,
        pricing,
        market: {
            countryCode: market.countryCode,
            currency: pricing.displayCurrency,
            language: market.language,
        },
    };
};

const mapItemsWithMarketPricing = async (items = [], market = null) => Promise.all(
    (Array.isArray(items) ? items : []).map((item) => attachMarketPricingToLine(item, market))
);

const buildWishlistResponse = async (userLike = {}, market = null) => ({
    items: await mapItemsWithMarketPricing(userLike?.wishlist || [], market),
    revision: Number(userLike?.wishlistRevision || 0),
    syncedAt: userLike?.wishlistSyncedAt || null,
    market: market ? {
        countryCode: market.countryCode,
        currency: market.currency,
        language: market.language,
    } : null,
});

const parseExpectedRevision = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return Number.NaN;
    return parsed;
};

const sendWishlistConflict = async (res, userLike, market = null) => (
    res.status(409).json({
        code: 'wishlist_revision_conflict',
        message: 'Wishlist revision conflict',
        ...(await buildWishlistResponse(userLike, market)),
    })
);

const buildWishlistMutationPayload = (hydratedWishlist = []) => ({
    wishlist: hydratedWishlist,
    wishlistSyncedAt: new Date(),
});

const getEntityMutationConfig = () => {
    return {
        field: 'wishlist',
        revisionField: 'wishlistRevision',
        hydrateItems: hydrateWishlistWithLiveProducts,
        buildMutationPayload: buildWishlistMutationPayload,
        snapshotsEqual: wishlistSnapshotsEqual,
    };
};

const loadFreshUserDocument = async (userId) => {
    if (!userId) return null;
    return User.findById(userId);
};

const commitEntityMutationByRevision = async (user, hydratedItems = [], baseRevision = null) => {
    const config = getEntityMutationConfig();
    const expectedRevision = Number(baseRevision ?? user?.[config.revisionField] ?? 0);
    const persistedUser = await User.findOneAndUpdate(
        {
            _id: user._id,
            [config.revisionField]: expectedRevision,
        },
        {
            $set: config.buildMutationPayload(hydratedItems),
            $inc: { [config.revisionField]: 1 },
        },
        {
            new: true,
        }
    );

    return {
        user: persistedUser,
        hydratedItems,
    };
};

const ensureHydratedUserEntityDocument = async (user) => {
    const config = getEntityMutationConfig();
    let currentUser = user;
    let attempts = 0;

    while (currentUser && attempts < 3) {
        const currentItems = Array.isArray(currentUser?.[config.field]) ? currentUser[config.field] : [];
        const hydratedItems = await config.hydrateItems(currentItems);

        if (config.snapshotsEqual(hydratedItems, currentItems)) {
            return currentUser;
        }

        const { user: persistedUser } = await commitEntityMutationByRevision(currentUser, hydratedItems, Number(currentUser?.[config.revisionField] ?? 0));

        if (persistedUser) {
            return persistedUser;
        }

        currentUser = await loadFreshUserDocument(currentUser._id);
        attempts += 1;
    }

    return currentUser;
};

const persistEntityMutation = async (user, nextItems = []) => {
    const config = getEntityMutationConfig();
    const hydratedItems = await config.hydrateItems(nextItems);
    const { user: persistedUser } = await commitEntityMutationByRevision(user, hydratedItems, Number(user?.[config.revisionField] ?? 0));

    if (persistedUser) {
        return {
            user: persistedUser,
            hydratedItems,
            conflict: false,
        };
    }

    return {
        user: await ensureHydratedUserEntityDocument(await loadFreshUserDocument(user?._id)),
        hydratedItems,
        conflict: true,
    };
};

const buildWishlistLineFromProduct = (productDoc, addedAt = new Date()) => ({
    id: Number(productDoc?.id || 0),
    title: normalizeText(productDoc?.title) || '',
    price: Number(productDoc?.price || 0),
    originalPrice: Number(productDoc?.originalPrice || productDoc?.price || 0),
    discountPercentage: Number(productDoc?.discountPercentage || 0),
    image: buildProductImageDeliveryUrl(normalizeText(productDoc?.image) || ''),
    brand: normalizeText(productDoc?.brand) || '',
    rating: Number(productDoc?.rating || 0),
    ratingCount: Math.max(0, Number(productDoc?.ratingCount || 0)),
    stock: Math.max(0, Number(productDoc?.stock || 0)),
    deliveryTime: normalizeText(productDoc?.deliveryTime) || '',
    category: normalizeText(productDoc?.category) || '',
    addedAt,
});

const mergeWishlistItems = (primaryItems = [], secondaryItems = []) => {
    const mergedById = new Map();
    const orderedIds = [];

    [...primaryItems, ...secondaryItems].forEach((item) => {
        const normalized = normalizeWishlistItemPayload(item);
        const key = Number(normalized.id);
        if (!Number.isFinite(key) || key <= 0) return;

        if (!mergedById.has(key)) {
            orderedIds.push(key);
            mergedById.set(key, normalized);
            return;
        }

        const existing = mergedById.get(key);
        mergedById.set(key, {
            ...existing,
            ...normalized,
            addedAt: existing.addedAt || normalized.addedAt || new Date(),
        });
    });

    return orderedIds.map((id) => mergedById.get(id));
};

const ensureHydratedUserWishlistDocument = async (user) => {
    return ensureHydratedUserEntityDocument(user);
};

const persistWishlistMutation = async (user, nextWishlist = []) => {
    const result = await persistEntityMutation(user, nextWishlist);
    return {
        user: result.user,
        hydratedWishlist: result.hydratedItems,
        conflict: result.conflict,
    };
};

const normalizeWishlistItemPayload = (item = {}) => {
    const normalizedId = Number(item.id);
    const normalizedPrice = Number(item.price || 0);
    const normalizedOriginalPrice = Number(item.originalPrice || item.price || 0);
    return {
        id: Number.isFinite(normalizedId) ? normalizedId : 0,
        title: normalizeText(item.title) || '',
        price: Number.isFinite(normalizedPrice) ? normalizedPrice : 0,
        originalPrice: Number.isFinite(normalizedOriginalPrice) ? normalizedOriginalPrice : 0,
        discountPercentage: Number(item.discountPercentage || 0),
        image: normalizeText(item.image) || '',
        brand: normalizeText(item.brand) || '',
        rating: Number(item.rating || 0),
        ratingCount: Math.max(0, Number(item.ratingCount || 0)),
        stock: Math.max(0, Number(item.stock || 0)),
        deliveryTime: normalizeText(item.deliveryTime) || '',
        category: normalizeText(item.category) || '',
        addedAt: item?.addedAt || new Date(),
    };
};

const requireAuthorizedEmail = (req, next) => {
    const safeEmail = normalizeEmail(req.user?.email);
    if (!safeEmail) {
        next(new AppError('Not authorized', 401));
        return null;
    }
    return safeEmail;
};

const loadLiveProductById = async (productId) => {
    const safeProductId = Number(productId);
    if (!Number.isFinite(safeProductId) || safeProductId <= 0) return null;

    return Product.findOne({ id: safeProductId })
        .select('id title price image stock brand discountPercentage originalPrice rating ratingCount deliveryTime category')
        .lean();
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
        returnDocument: 'after',
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
                returnDocument: 'after',
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

    const hydratedUser = await ensureHydratedUserWishlistDocument(user);
    const cartSnapshot = await getDedicatedCartSnapshot({
        userId: hydratedUser._id,
        user: hydratedUser,
        market: req.market,
    });
    const legacyCart = buildDedicatedLegacyCartResponse(cartSnapshot, req.market);

    await persistAuthSnapshot(hydratedUser);

    res.json({
        _id: hydratedUser._id,
        name: hydratedUser.name,
        email: hydratedUser.email,
        phone: hydratedUser.phone,
        avatar: hydratedUser.avatar || '',
        gender: hydratedUser.gender || '',
        dob: hydratedUser.dob || null,
        bio: hydratedUser.bio || '',
        isAdmin: hydratedUser.isAdmin,
        isVerified: hydratedUser.isVerified,
        isSeller: Boolean(hydratedUser.isSeller),
        sellerActivatedAt: hydratedUser.sellerActivatedAt || null,
        accountState: hydratedUser.accountState || 'active',
        moderation: hydratedUser.moderation || {},
        addresses: hydratedUser.addresses || [],
        cart: legacyCart.items,
        wishlist: hydratedUser.wishlist || [],
        wishlistRevision: Number(hydratedUser.wishlistRevision || 0),
        wishlistSyncedAt: hydratedUser.wishlistSyncedAt || null,
        cartRevision: legacyCart.revision,
        cartSyncedAt: legacyCart.syncedAt,
        loyalty: getRewardSnapshotFromUser(hydratedUser),
        createdAt: hydratedUser.createdAt,
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
            { returnDocument: 'after', projection: PROFILE_PROJECTION, lean: true }
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
        projection: '_id loyalty wishlist',
    });
    if (!user) return next(new AppError('Unable to recover user profile', 500));

    const [orders, listingStats, cartSnapshot] = await Promise.all([
        Order.find({ user: user._id })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
        Listing.aggregate([
            { $match: { seller: user._id } },
            { $group: { _id: '$status', count: { $sum: 1 }, totalViews: { $sum: '$views' } } }
        ]),
        getDedicatedCartSnapshot({
            userId: user._id,
            user,
        }),
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
            wishlistCount: Array.isArray(user?.wishlist) ? user.wishlist.length : 0,
            cartCount: Number(cartSnapshot?.summary?.totalQuantity || 0),
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

// @desc    Get wishlist snapshot
// @route   GET /api/users/wishlist
// @access  Private
const getWishlist = asyncHandler(async (req, res, next) => {
    const safeEmail = requireAuthorizedEmail(req, next);
    if (!safeEmail) return;

    let user = await ensureUserDocument({
        email: safeEmail,
        authUser: req.user,
    });
    if (!user) {
        return next(new AppError('Unable to recover user profile', 500));
    }

    user = await ensureHydratedUserWishlistDocument(user);
    return res.json(await buildWishlistResponse(user, req.market));
});

// @desc    Sync wishlist snapshot (legacy full replacement)
// @route   PUT /api/users/wishlist
// @access  Private
const syncWishlist = asyncHandler(async (req, res, next) => {
    const { wishlistItems } = req.body;
    const expectedRevision = parseExpectedRevision(req.body?.expectedRevision);

    if (!Array.isArray(wishlistItems)) {
        return next(new AppError('wishlistItems must be an array', 400));
    }
    if (Number.isNaN(expectedRevision)) {
        return next(new AppError('expectedRevision must be a non-negative number', 400));
    }

    const safeEmail = requireAuthorizedEmail(req, next);
    if (!safeEmail) return;

    let user = await ensureUserDocument({
        email: safeEmail,
        authUser: req.user,
    });
    if (!user) {
        return next(new AppError('Unable to recover user profile', 500));
    }

    user = await ensureHydratedUserWishlistDocument(user);

    if (expectedRevision !== null && Number(user.wishlistRevision || 0) !== expectedRevision) {
        return sendWishlistConflict(res, user, req.market);
    }

    const { user: persistedUser, conflict } = await persistWishlistMutation(user, wishlistItems);
    if (conflict) {
        return sendWishlistConflict(res, persistedUser || user, req.market);
    }
    return res.json(await buildWishlistResponse(persistedUser, req.market));
});

// @desc    Add wishlist item
// @route   POST /api/users/wishlist/items
// @access  Private
const addWishlistItem = asyncHandler(async (req, res, next) => {
    const productId = Number(req.body?.productId);
    const expectedRevision = parseExpectedRevision(req.body?.expectedRevision);

    if (!Number.isFinite(productId) || productId <= 0) {
        return next(new AppError('productId must be a valid product identifier', 400));
    }
    if (Number.isNaN(expectedRevision)) {
        return next(new AppError('expectedRevision must be a non-negative number', 400));
    }

    const safeEmail = requireAuthorizedEmail(req, next);
    if (!safeEmail) return;

    let user = await ensureUserDocument({
        email: safeEmail,
        authUser: req.user,
    });
    if (!user) {
        return next(new AppError('Unable to recover user profile', 500));
    }

    user = await ensureHydratedUserWishlistDocument(user);

    if (expectedRevision !== null && Number(user.wishlistRevision || 0) !== expectedRevision) {
        return sendWishlistConflict(res, user, req.market);
    }

    const liveProduct = await loadLiveProductById(productId);
    if (!liveProduct) {
        return next(new AppError('Product not found', 404));
    }

    const nextWishlist = Array.isArray(user.wishlist)
        ? user.wishlist.map((item) => normalizeWishlistItemPayload(item))
        : [];
    const existingIndex = nextWishlist.findIndex((item) => Number(item.id) === productId);

    if (existingIndex >= 0) {
        const existingAddedAt = nextWishlist[existingIndex]?.addedAt || new Date();
        nextWishlist[existingIndex] = buildWishlistLineFromProduct(liveProduct, existingAddedAt);
    } else {
        nextWishlist.push(buildWishlistLineFromProduct(liveProduct));
    }

    const { user: persistedUser, hydratedWishlist, conflict } = await persistWishlistMutation(user, nextWishlist);
    if (conflict) {
        return sendWishlistConflict(res, persistedUser || user, req.market);
    }
    const changedItem = hydratedWishlist.find((item) => Number(item.id) === productId) || null;

    return res.status(existingIndex >= 0 ? 200 : 201).json({
        item: changedItem,
        revision: Number(persistedUser.wishlistRevision || 0),
        syncedAt: persistedUser.wishlistSyncedAt || null,
    });
});

// @desc    Remove wishlist item
// @route   DELETE /api/users/wishlist/items/:productId
// @access  Private
const removeWishlistItem = asyncHandler(async (req, res, next) => {
    const productId = Number(req.params.productId);
    const expectedRevision = parseExpectedRevision(req.body?.expectedRevision);

    if (!Number.isFinite(productId) || productId <= 0) {
        return next(new AppError('productId must be a valid product identifier', 400));
    }
    if (Number.isNaN(expectedRevision)) {
        return next(new AppError('expectedRevision must be a non-negative number', 400));
    }

    const safeEmail = requireAuthorizedEmail(req, next);
    if (!safeEmail) return;

    let user = await ensureUserDocument({
        email: safeEmail,
        authUser: req.user,
    });
    if (!user) {
        return next(new AppError('Unable to recover user profile', 500));
    }

    user = await ensureHydratedUserWishlistDocument(user);

    if (expectedRevision !== null && Number(user.wishlistRevision || 0) !== expectedRevision) {
        return sendWishlistConflict(res, user, req.market);
    }

    const currentWishlist = Array.isArray(user.wishlist)
        ? user.wishlist.map((item) => normalizeWishlistItemPayload(item))
        : [];
    const nextWishlist = currentWishlist.filter((item) => Number(item.id) !== productId);

    if (nextWishlist.length === currentWishlist.length) {
        return res.json({
            revision: Number(user.wishlistRevision || 0),
            syncedAt: user.wishlistSyncedAt || null,
        });
    }

    const { user: persistedUser, conflict } = await persistWishlistMutation(user, nextWishlist);
    if (conflict) {
        return sendWishlistConflict(res, persistedUser || user, req.market);
    }
    return res.json({
        revision: Number(persistedUser.wishlistRevision || 0),
        syncedAt: persistedUser.wishlistSyncedAt || null,
    });
});

// @desc    Merge guest wishlist into user wishlist
// @route   POST /api/users/wishlist/merge
// @access  Private
const mergeWishlist = asyncHandler(async (req, res, next) => {
    const incomingItems = req.body?.items;
    const expectedRevision = parseExpectedRevision(req.body?.expectedRevision);

    if (!Array.isArray(incomingItems)) {
        return next(new AppError('items must be an array', 400));
    }
    if (Number.isNaN(expectedRevision)) {
        return next(new AppError('expectedRevision must be a non-negative number', 400));
    }

    const safeEmail = requireAuthorizedEmail(req, next);
    if (!safeEmail) return;

    let user = await ensureUserDocument({
        email: safeEmail,
        authUser: req.user,
    });
    if (!user) {
        return next(new AppError('Unable to recover user profile', 500));
    }

    user = await ensureHydratedUserWishlistDocument(user);

    if (expectedRevision !== null && Number(user.wishlistRevision || 0) !== expectedRevision) {
        return sendWishlistConflict(res, user, req.market);
    }

    const mergedWishlist = mergeWishlistItems(user.wishlist || [], incomingItems);
    const { user: persistedUser, conflict } = await persistWishlistMutation(user, mergedWishlist);
    if (conflict) {
        return sendWishlistConflict(res, persistedUser || user, req.market);
    }
    return res.json(await buildWishlistResponse(persistedUser, req.market));
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
};
