const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const { isValidObjectId: isValidObjectIdMongoose } = require('mongoose'); // Renamed to avoid conflict
const Listing = require('../models/Listing');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { flags: paymentFlags } = require('../config/paymentFlags');
const {
    normalizeListingInput,
    getIntegrityIssue,
    buildRealListingsFilter,
    isRealListingDoc,
} = require('../services/marketplaceIntegrityService');
const { buildSellerTrustPassport } = require('../services/sellerTrustService');
const { awardLoyaltyPoints } = require('../services/loyaltyService');
const {
    serializeThreadForUser,
    sendCounterpartyMessageEmail,
    assertEscrowEligibility,
    buildEscrowCheckoutPayload,
    appendEscrowPaymentEvent,
    SELLER_PUBLIC,
} = require('../services/listingService');
const { getPaymentProvider } = require('../services/payments/providerFactory');
const { evaluateRisk } = require('../services/payments/riskEngine');
const { captureIntentNow } = require('../services/payments/paymentService');
const {
    DIGITAL_METHODS,
    INTENT_EXPIRY_MINUTES,
    PAYMENT_STATUSES,
} = require('../services/payments/constants');
const {
    makeEventId,
    makeIntentId,
    normalizeMethod,
    roundCurrency,
} = require('../services/payments/helpers');
const { sendMessageToUser } = require('../services/socketService');
const { solveAuraMatch } = require('../services/marketplaceOptimizers');

const MAX_ACTIVE_LISTINGS = 10;
const MAX_CHAT_MESSAGE_LENGTH = 1200;
const MAX_CHAT_MESSAGES_PER_THREAD = 200;
const MAX_CHAT_THREADS_PER_LISTING = 60;
const HOTSPOT_LIMIT_DEFAULT = 8;
const HOTSPOT_LIMIT_MAX = 16;
const HOTSPOT_WINDOW_DEFAULT_DAYS = 21;

// ── Projection for list views (exclude heavy fields) ─────────
const LIST_PROJECTION = 'title price negotiable condition category images location status views seller createdAt escrowOptIn escrow disputeCount';
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const normalizeGeoToken = (value) => String(value || '').trim().toLowerCase();
const toHotspotLabel = (score) => {
    if (score >= 75) return 'blazing';
    if (score >= 58) return 'rising';
    if (score >= 40) return 'balanced';
    return 'cooling';
};
const toSignalLabel = (score) => {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
};
const normalizeMessageText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const isValidObjectId = (value) => isValidObjectIdMongoose(String(value || ''));
const ESCROW_PAYMENT_PURPOSE = 'marketplace_escrow';

const diff = (a, b) => Math.abs(Number(a) - Number(b));
const isIntentExpired = (intent) => intent?.expiresAt && new Date(intent.expiresAt).getTime() < Date.now();

// Escrow eligibility checks moved to listingService

const createEscrowIntent = asyncHandler(async (req, res, next) => {
    if (!paymentFlags.paymentsEnabled) {
        return next(new AppError('Marketplace payments are currently disabled', 503));
    }

    const listing = await Listing.findById(req.params.id).populate('seller', SELLER_PUBLIC);
    try {
        assertEscrowEligibility({ listing, userId: req.user._id, allowHeld: false });
    } catch (error) {
        return next(error);
    }

    const paymentMethod = normalizeMethod(req.body?.paymentMethod || 'UPI');
    if (!DIGITAL_METHODS.includes(paymentMethod)) {
        return next(new AppError('Marketplace escrow supports digital methods only (UPI/CARD/WALLET)', 400));
    }

    const activeIntent = await PaymentIntent.findOne({
        user: req.user._id,
        status: { $in: [PAYMENT_STATUSES.CREATED, PAYMENT_STATUSES.CHALLENGE_PENDING, PAYMENT_STATUSES.AUTHORIZED, PAYMENT_STATUSES.CAPTURED] },
        expiresAt: { $gt: new Date() },
        'metadata.purpose': ESCROW_PAYMENT_PURPOSE,
        'metadata.listingId': String(listing._id),
    }).sort({ createdAt: -1 }).lean();

    if (activeIntent) {
        return res.json({
            intentId: activeIntent.intentId,
            provider: activeIntent.provider,
            providerOrderId: activeIntent.providerOrderId,
            amount: activeIntent.amount,
            currency: activeIntent.currency,
            status: activeIntent.status,
            riskDecision: activeIntent.riskSnapshot?.decision || 'allow',
            challengeRequired: Boolean(activeIntent.challenge?.required && activeIntent.challenge?.status !== 'verified'),
            checkoutPayload: activeIntent.metadata?.checkoutPayload || null,
            simulatedConfirm: activeIntent.metadata?.simulatedConfirm || null,
            listingId: String(listing._id),
        });
    }

    const amount = roundCurrency(listing.price || 0);
    if (amount <= 0) {
        return next(new AppError('Invalid listing price for escrow payment', 409));
    }

    const risk = await evaluateRisk({
        userId: req.user._id,
        amount,
        deviceContext: req.body?.deviceContext || {},
        requestMeta: {
            ip: req.ip || req.connection?.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
        },
        shippingAddress: {
            address: listing.location?.city || 'Unknown',
            city: listing.location?.city || 'Unknown',
            postalCode: listing.location?.pincode || '000000',
            country: listing.location?.state || 'India',
        },
        mode: paymentFlags.paymentRiskMode,
    });

    if (risk.blocked) {
        return next(new AppError('Escrow payment blocked by risk policy. Try another method or contact support.', 403));
    }

    const provider = await getPaymentProvider({
        amount,
        currency: 'INR',
        paymentMethod: 'CARD', // Defaulting for escrow if unknown
        userId: req.user._id,
    });
    const intentId = makeIntentId();
    const providerOrder = await provider.createOrder({
        amount,
        currency: 'INR',
        receipt: intentId,
        notes: {
            intentId,
            listingId: String(listing._id),
            buyerId: String(req.user._id),
            sellerId: String(listing.seller?._id || listing.seller),
            purpose: ESCROW_PAYMENT_PURPOSE,
        },
    });

    const challengeRequired = Boolean(paymentFlags.paymentChallengeEnabled && risk.challengeRequired);
    const status = challengeRequired ? PAYMENT_STATUSES.CHALLENGE_PENDING : PAYMENT_STATUSES.CREATED;
    const expiresAt = new Date(Date.now() + (INTENT_EXPIRY_MINUTES * 60 * 1000));
    const checkoutPayload = buildEscrowCheckoutPayload({
        providerOrderId: providerOrder.id,
        amount,
        currency: 'INR',
        user: req.user,
    });
    const simulatedConfirm = checkoutPayload.simulatedConfirm || null;

    const intent = await PaymentIntent.create({
        intentId,
        user: req.user._id,
        provider: provider.name,
        providerOrderId: providerOrder.id,
        amount,
        currency: 'INR',
        method: paymentMethod,
        status,
        riskSnapshot: {
            score: risk.score,
            decision: risk.strictDecision,
            factors: risk.factors,
            mode: risk.mode,
        },
        challenge: {
            required: challengeRequired,
            status: challengeRequired ? 'pending' : 'none',
            verifiedAt: null,
        },
        expiresAt,
        metadata: {
            purpose: ESCROW_PAYMENT_PURPOSE,
            listingId: String(listing._id),
            listingTitle: String(listing.title || ''),
            sellerId: String(listing.seller?._id || listing.seller),
            sellerEmail: String(listing.seller?.email || ''),
            checkoutPayload,
            simulatedConfirm,
            ip: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
            deviceContext: req.body?.deviceContext || {},
        },
    });

    await appendEscrowPaymentEvent({
        intentId: intent.intentId,
        source: 'api',
        type: 'marketplace.escrow.intent_created',
        payload: {
            listingId: String(listing._id),
            amount,
            paymentMethod,
            riskDecision: risk.strictDecision,
        },
    });

    return res.json({
        intentId: intent.intentId,
        provider: intent.provider,
        providerOrderId: intent.providerOrderId,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        riskDecision: risk.strictDecision,
        challengeRequired,
        checkoutPayload,
        simulatedConfirm,
        listingId: String(listing._id),
    });
});

const confirmEscrowIntent = asyncHandler(async (req, res, next) => {
    if (!paymentFlags.paymentsEnabled) {
        return next(new AppError('Marketplace payments are currently disabled', 503));
    }

    const listing = await Listing.findById(req.params.id).populate('seller', SELLER_PUBLIC);
    try {
        assertEscrowEligibility({ listing, userId: req.user._id, allowHeld: true });
    } catch (error) {
        return next(error);
    }

    const intent = await PaymentIntent.findOne({ intentId: req.params.intentId, user: req.user._id });
    if (!intent) {
        return next(new AppError('Escrow payment intent not found for this user', 404));
    }
    if (String(intent.metadata?.purpose || '') !== ESCROW_PAYMENT_PURPOSE) {
        return next(new AppError('Payment intent is not valid for marketplace escrow', 409));
    }
    if (String(intent.metadata?.listingId || '') !== String(listing._id)) {
        return next(new AppError('Escrow payment intent does not match this listing', 409));
    }
    if (isIntentExpired(intent)) {
        intent.status = PAYMENT_STATUSES.EXPIRED;
        await intent.save();
        return next(new AppError('Escrow payment intent expired. Start payment again.', 409));
    }
    if (intent.challenge?.required && intent.challenge?.status !== 'verified') {
        return next(new AppError('Payment challenge must be completed before confirmation', 403));
    }
    if (intent.status === PAYMENT_STATUSES.CAPTURED || intent.status === PAYMENT_STATUSES.AUTHORIZED) {
        return res.json({
            intentId: intent.intentId,
            status: intent.status,
            authorizedAt: intent.authorizedAt,
            providerOrderId: intent.providerOrderId,
            riskDecision: intent.riskSnapshot?.decision || 'allow',
        });
    }

    const providerOrderId = String(req.body?.providerOrderId || '').trim();
    const providerPaymentId = String(req.body?.providerPaymentId || '').trim();
    const providerSignature = String(req.body?.providerSignature || '').trim();
    if (!providerOrderId || !providerPaymentId || !providerSignature) {
        return next(new AppError('providerOrderId, providerPaymentId and providerSignature are required', 400));
    }
    if (providerOrderId !== intent.providerOrderId) {
        return next(new AppError('Provider order mismatch for escrow confirmation', 409));
    }

    const provider = await getPaymentProvider({
        amount: intent.amount,
        currency: intent.currency,
        paymentMethod: intent.method,
        userId: intent.user,
    });
    const verified = provider.verifySignature({
        orderId: providerOrderId,
        paymentId: providerPaymentId,
        signature: providerSignature,
    });
    if (!verified) {
        return next(new AppError('Invalid escrow payment signature', 400));
    }

    const payment = await provider.fetchPayment(providerPaymentId);
    const providerStatus = String(payment?.status || '').toLowerCase();
    const nextStatus = providerStatus === 'captured' ? PAYMENT_STATUSES.CAPTURED : PAYMENT_STATUSES.AUTHORIZED;

    intent.providerPaymentId = providerPaymentId;
    intent.providerMethodId = payment.card_id || payment.vpa || payment.wallet || '';
    intent.status = nextStatus;
    intent.authorizedAt = new Date();
    intent.attemptCount = Number(intent.attemptCount || 0) + 1;
    if (nextStatus === PAYMENT_STATUSES.CAPTURED) {
        intent.capturedAt = new Date();
    }
    await intent.save();

    await appendEscrowPaymentEvent({
        intentId: intent.intentId,
        source: 'api',
        type: 'marketplace.escrow.intent_confirmed',
        payload: {
            listingId: String(listing._id),
            providerPaymentId,
            providerOrderId,
            status: nextStatus,
        },
    });

    return res.json({
        intentId: intent.intentId,
        status: intent.status,
        authorizedAt: intent.authorizedAt,
        providerOrderId: intent.providerOrderId,
        riskDecision: intent.riskSnapshot?.decision || 'allow',
    });
});

/**
 * @desc    Create a new listing
 * @route   POST /api/listings
 * @access  Private
 */
const createListing = asyncHandler(async (req, res, next) => {
    const {
        title,
        description,
        price,
        negotiable,
        condition,
        category,
        images,
        location,
    } = normalizeListingInput(req.body);

    if (!title || !description || !price || !condition || !category || !images?.length || !location?.city || !location?.state) {
        return next(new AppError('All fields are required: title, description, price, condition, category, images, location (city, state)', 400));
    }

    if (!req.user?.isVerified) {
        return next(new AppError('Account verification required before creating a listing.', 403));
    }

    if (!req.user?.phone) {
        return next(new AppError('Add a valid phone number in profile before creating a listing.', 400));
    }

    const integrityIssue = getIntegrityIssue({ title, description, images });
    if (integrityIssue) {
        return next(new AppError(integrityIssue, 400));
    }

    if (images.length > 5) {
        return next(new AppError('Maximum 5 images allowed', 400));
    }

    // Check max active listings per user
    const activeCount = await Listing.countDocuments({ seller: req.user._id, status: 'active' });
    if (activeCount >= MAX_ACTIVE_LISTINGS) {
        return next(new AppError(`You can have a maximum of ${MAX_ACTIVE_LISTINGS} active listings. Please remove or mark some as sold.`, 400));
    }

    const listing = await Listing.create({
        seller: req.user._id,
        title, description, price, negotiable: negotiable !== false,
        condition, category, images,
        location: {
            city: location.city,
            state: location.state,
            pincode: location.pincode || '',
            latitude: location.latitude ?? null,
            longitude: location.longitude ?? null,
            accuracyMeters: location.accuracyMeters ?? null,
            confidence: location.confidence ?? null,
            provider: location.provider || '',
            capturedAt: location.capturedAt || null,
        },
        source: 'user',
        escrowOptIn: Boolean(req.body.escrowOptIn),
        escrow: {
            enabled: false,
            state: 'none',
            buyer: null,
            amount: 0,
            holdReference: '',
            startedAt: null,
            confirmedAt: null,
            releasedAt: null,
        },
    });

    try {
        await awardLoyaltyPoints({
            userId: req.user._id,
            action: 'listing_created',
            refId: String(listing._id),
        });
    } catch (rewardError) {
        logger.warn('loyalty.listing_reward_failed', {
            userId: String(req.user._id),
            listingId: String(listing._id),
            error: rewardError.message,
        });
    }

    res.status(201).json({ success: true, listing });
});

/**
 * @desc    Get all listings with filters
 * @route   GET /api/listings
 * @access  Public
 */
const getListings = asyncHandler(async (req, res) => {
    const {
        category, city, condition, search,
        minPrice, maxPrice,
        sort = 'newest',
        page = 1, limit = 12
    } = req.query;

    const baseFilter = { status: 'active' };

    if (category) baseFilter.category = category;
    if (city) baseFilter['location.city'] = { $regex: new RegExp(city, 'i') };
    if (condition) baseFilter.condition = condition;
    if (minPrice || maxPrice) {
        baseFilter.price = {};
        if (minPrice) baseFilter.price.$gte = Number(minPrice);
        if (maxPrice) baseFilter.price.$lte = Number(maxPrice);
    }
    if (search) {
        baseFilter.$text = { $search: search };
    }
    const filter = buildRealListingsFilter(baseFilter);

    // Sort options
    const sortMap = {
        'newest': { createdAt: -1 },
        'oldest': { createdAt: 1 },
        'price-low': { price: 1 },
        'price-high': { price: -1 },
        'most-viewed': { views: -1 }
    };
    const sortOrder = sortMap[sort] || sortMap.newest;

    const skip = (Number(page) - 1) * Number(limit);

    const [listings, total] = await Promise.all([
        Listing.find(filter, LIST_PROJECTION)
            .populate('seller', 'name createdAt isVerified reputationScore')
            .sort(sortOrder)
            .skip(skip)
            .limit(Number(limit))
            .lean(),
        Listing.countDocuments(filter)
    ]);

    res.json({
        success: true,
        // NP-Hard: Aura-Match (Stable Matching)
        listings: solveAuraMatch({ categoryWeights: { 'Electronics': 2 }, maxPrice: 50000, minTrust: 80 }, listings),
        pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit))
        }
    });
});

/**
 * @desc    Get single listing detail
 * @route   GET /api/listings/:id
 * @access  Public
 */
const getListingById = asyncHandler(async (req, res, next) => {
    const listing = await Listing.findById(req.params.id)
        .populate('seller', SELLER_PUBLIC);

    if (!listing || !isRealListingDoc(listing)) {
        return next(new AppError('Listing not found', 404));
    }

    // Increment view count (fire-and-forget)
    Listing.updateOne({ _id: listing._id }, { $inc: { views: 1 } }).exec();

    const trustPassport = listing?.seller?._id
        ? await buildSellerTrustPassport({ sellerId: listing.seller._id, sellerUser: listing.seller })
        : null;

    res.json({
        success: true,
        listing,
        trustPassport,
    });
});

/**
 * @desc    Get city/category hotspot intelligence for marketplace GPS view
 * @route   GET /api/listings/hotspots
 * @access  Public
 */
const getCityHotspots = asyncHandler(async (req, res) => {
    const category = String(req.query.category || '').trim();
    const city = String(req.query.city || '').trim();
    const state = String(req.query.state || '').trim();

    const limit = clamp(Number(req.query.limit) || HOTSPOT_LIMIT_DEFAULT, 1, HOTSPOT_LIMIT_MAX);
    const windowDays = clamp(Number(req.query.windowDays) || HOTSPOT_WINDOW_DEFAULT_DAYS, 7, 90);
    const soldSince = new Date(Date.now() - (windowDays * 24 * 60 * 60 * 1000));
    const categoryFilter = category ? { category } : {};

    const activeBase = { status: 'active', ...categoryFilter };
    const soldBase = { status: 'sold', soldAt: { $gte: soldSince }, ...categoryFilter };

    const [supplyAgg, demandAgg] = await Promise.all([
        Listing.aggregate([
            { $match: buildRealListingsFilter(activeBase) },
            {
                $group: {
                    _id: {
                        city: '$location.city',
                        state: '$location.state',
                        category: '$category',
                    },
                    supplyCount: { $sum: 1 },
                    totalViews: { $sum: { $ifNull: ['$views', 0] } },
                    avgPrice: { $avg: '$price' },
                },
            },
            { $match: { '_id.city': { $ne: null }, '_id.state': { $ne: null } } },
        ]),
        Listing.aggregate([
            { $match: buildRealListingsFilter(soldBase) },
            {
                $group: {
                    _id: {
                        city: '$location.city',
                        state: '$location.state',
                        category: '$category',
                    },
                    soldCount: { $sum: 1 },
                },
            },
            { $match: { '_id.city': { $ne: null }, '_id.state': { $ne: null } } },
        ]),
    ]);

    const hotspotMap = new Map();
    const getKey = (entry) => [
        normalizeGeoToken(entry?._id?.city),
        normalizeGeoToken(entry?._id?.state),
        normalizeGeoToken(entry?._id?.category),
    ].join('::');

    for (const entry of supplyAgg) {
        hotspotMap.set(getKey(entry), {
            city: String(entry._id.city || '').trim(),
            state: String(entry._id.state || '').trim(),
            category: String(entry._id.category || '').trim(),
            supplyCount: Number(entry.supplyCount || 0),
            soldCount: 0,
            totalViews: Number(entry.totalViews || 0),
            avgPrice: Math.round(Number(entry.avgPrice || 0)),
        });
    }

    for (const entry of demandAgg) {
        const key = getKey(entry);
        const existing = hotspotMap.get(key) || {
            city: String(entry._id.city || '').trim(),
            state: String(entry._id.state || '').trim(),
            category: String(entry._id.category || '').trim(),
            supplyCount: 0,
            soldCount: 0,
            totalViews: 0,
            avgPrice: 0,
        };
        existing.soldCount = Number(entry.soldCount || 0);
        hotspotMap.set(key, existing);
    }

    const queryCity = normalizeGeoToken(city);
    const queryState = normalizeGeoToken(state);

    const hotspots = Array.from(hotspotMap.values())
        .map((entry) => {
            const cityToken = normalizeGeoToken(entry.city);
            const stateToken = normalizeGeoToken(entry.state);

            const proximity =
                queryCity && cityToken === queryCity
                    ? 'local'
                    : queryState && stateToken === queryState
                        ? 'regional'
                        : 'national';

            const demandScore = clamp((entry.soldCount * 14) + Math.round(entry.totalViews / 40), 0, 100);
            const supplyScore = clamp(entry.supplyCount * 8, 0, 100);
            const ratio = entry.supplyCount > 0 ? Number((entry.soldCount / entry.supplyCount).toFixed(2)) : 0;
            const baseHeatScore = clamp(Math.round((demandScore * 0.68) + ((100 - supplyScore) * 0.32)), 0, 100);
            const proximityBoost = proximity === 'local' ? 8 : proximity === 'regional' ? 3 : 0;
            const heatScore = clamp(baseHeatScore + proximityBoost, 0, 100);

            return {
                ...entry,
                proximity,
                demandScore,
                supplyScore,
                demandLevel: toSignalLabel(demandScore),
                supplyLevel: toSignalLabel(supplyScore),
                demandSupplyRatio: ratio,
                heatScore,
                heatLabel: toHotspotLabel(heatScore),
            };
        })
        .sort((a, b) => b.heatScore - a.heatScore)
        .slice(0, limit);

    // NP-Hard: Aura-Cluster (K-Median Clustering)
    // Identify demand centroids across all identified hotspots
    const points = hotspots.map(h => ({
        lat: h.avgPrice / 1000, // Normalized proxy for lat for the demo
        lng: h.supplyCount,     // Normalized proxy for lng for the demo
        weight: h.demandScore
    }));
    const clusters = solveAuraCluster(points, 3);

    res.json({
        success: true,
        meta: {
            category: category || 'all',
            city: city || null,
            state: state || null,
            windowDays,
            generatedAt: new Date().toISOString(),
        },
        hotspots,
        demandCentroids: clusters, // Enhanced GPS Intelligence
    });
});

/**
 * @desc    Update a listing
 * @route   PUT /api/listings/:id
 * @access  Private (owner only)
 */
const updateListing = asyncHandler(async (req, res, next) => {
    const listing = await Listing.findById(req.params.id);

    if (!listing) return next(new AppError('Listing not found', 404));
    if (listing.seller.toString() !== req.user._id.toString()) {
        return next(new AppError('Not authorized to edit this listing', 403));
    }

    const allowed = ['title', 'description', 'price', 'negotiable', 'condition', 'category', 'images', 'location', 'escrowOptIn'];
    const updates = {};
    allowed.forEach(key => {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    const normalized = normalizeListingInput({
        title: updates.title ?? listing.title,
        description: updates.description ?? listing.description,
        price: updates.price ?? listing.price,
        negotiable: updates.negotiable ?? listing.negotiable,
        condition: updates.condition ?? listing.condition,
        category: updates.category ?? listing.category,
        images: updates.images ?? listing.images,
        location: updates.location ?? listing.location,
    });

    const integrityIssue = getIntegrityIssue({
        title: normalized.title,
        description: normalized.description,
        images: normalized.images,
    });
    if (integrityIssue) {
        return next(new AppError(integrityIssue, 400));
    }

    if (updates.title !== undefined) updates.title = normalized.title;
    if (updates.description !== undefined) updates.description = normalized.description;
    if (updates.price !== undefined) updates.price = normalized.price;
    if (updates.negotiable !== undefined) updates.negotiable = normalized.negotiable;
    if (updates.condition !== undefined) updates.condition = normalized.condition;
    if (updates.category !== undefined) updates.category = normalized.category;
    if (updates.images !== undefined) updates.images = normalized.images;
    if (updates.location !== undefined) updates.location = normalized.location;
    if (updates.escrowOptIn !== undefined) updates.escrowOptIn = Boolean(updates.escrowOptIn);

    const updated = await Listing.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true, runValidators: true }
    ).populate('seller', SELLER_PUBLIC);

    res.json({ success: true, listing: updated });
});

/**
 * @desc    Mark listing as sold
 * @route   PATCH /api/listings/:id/sold
 * @access  Private (owner only)
 */
const markSold = asyncHandler(async (req, res, next) => {
    const listing = await Listing.findById(req.params.id);

    if (!listing) return next(new AppError('Listing not found', 404));
    if (listing.seller.toString() !== req.user._id.toString()) {
        return next(new AppError('Not authorized', 403));
    }

    listing.status = 'sold';
    listing.soldAt = new Date();
    await listing.save();

    res.json({ success: true, message: 'Listing marked as sold', listing });
});

/**
 * @desc    Delete a listing
 * @route   DELETE /api/listings/:id
 * @access  Private (owner only)
 */
const deleteListing = asyncHandler(async (req, res, next) => {
    const listing = await Listing.findById(req.params.id);

    if (!listing) return next(new AppError('Listing not found', 404));
    if (listing.seller.toString() !== req.user._id.toString()) {
        return next(new AppError('Not authorized', 403));
    }

    await Listing.deleteOne({ _id: listing._id });
    res.json({ success: true, message: 'Listing deleted' });
});

/**
 * @desc    Get current user's listings
 * @route   GET /api/listings/my
 * @access  Private
 */
const getMyListings = asyncHandler(async (req, res) => {
    const listings = await Listing.find({ seller: req.user._id })
        .sort({ createdAt: -1 })
        .lean();

    const stats = {
        active: listings.filter(l => l.status === 'active').length,
        sold: listings.filter(l => l.status === 'sold').length,
        totalViews: listings.reduce((sum, l) => sum + (l.views || 0), 0)
    };

    res.json({ success: true, listings, stats });
});

/**
 * @desc    Get a seller's public profile + active listings
 * @route   GET /api/listings/seller/:userId
 * @access  Public
 */
const getSellerProfile = asyncHandler(async (req, res, next) => {
    const seller = await User.findById(req.params.userId)
        .select('name createdAt isVerified')
        .lean();

    if (!seller) return next(new AppError('Seller not found', 404));

    const listings = await Listing.find(buildRealListingsFilter({ seller: req.params.userId, status: 'active' }))
        .sort({ createdAt: -1 })
        .lean();

    const totalSold = await Listing.countDocuments(buildRealListingsFilter({ seller: req.params.userId, status: 'sold' }));
    const trustPassport = await buildSellerTrustPassport({ sellerId: req.params.userId, sellerUser: seller });

    res.json({
        success: true,
        seller: {
            ...seller,
            activeListings: listings.length,
            totalSold,
            trustPassport,
        },
        listings
    });
});

/**
 * @desc    Get current user's marketplace message inbox
 * @route   GET /api/listings/messages/inbox
 * @access  Private
 */
const getMyMessageInbox = asyncHandler(async (req, res) => {
    const viewerId = req.user._id;

    // Fast indexed query: find all conversations where user is buyer OR seller
    const conversations = await Conversation.find({
        $or: [{ seller: viewerId }, { buyer: viewerId }],
        status: 'active'
    })
    .sort({ lastMessageAt: -1 })
    .populate('listing', 'title price images status')
    .populate('seller', 'name email avatar isVerified')
    .populate('buyer', 'name email avatar isVerified')
    .lean();

    const formattedConversations = conversations.map(conv => {
        const viewerIsSeller = String(conv.seller._id) === String(viewerId);
        
        return {
            listing: conv.listing,
            buyerId: String(conv.buyer._id),
            sellerId: String(conv.seller._id),
            sellerUser: viewerIsSeller ? null : {
                _id: conv.seller._id,
                name: conv.seller.name,
                avatar: conv.seller.avatar,
                isVerified: conv.seller.isVerified
            },
            buyerUser: viewerIsSeller ? {
                _id: conv.buyer._id,
                name: conv.buyer.name,
                avatar: conv.buyer.avatar,
                isVerified: conv.buyer.isVerified
            } : null,
            unreadBySeller: conv.unreadBySeller,
            unreadByBuyer: conv.unreadByBuyer,
            unreadCount: viewerIsSeller ? conv.unreadBySeller : conv.unreadByBuyer,
            lastMessageAt: conv.lastMessageAt,
            lastMessagePreview: conv.lastMessagePreview,
            messages: [], // Inbox doesn't need full message list
        };
    });

    res.json({
        success: true,
        conversations: formattedConversations,
    });
});

/**
 * @desc    Get listing conversation between current user and seller/buyer
 * @route   GET /api/listings/:id/messages
 * @access  Private
 */
const getListingMessages = asyncHandler(async (req, res, next) => {
    const listing = await Listing.findById(req.params.id)
        .select('title price images status seller')
        .lean();

    if (!listing) {
        return next(new AppError('Listing not found', 404));
    }

    const viewerId = String(req.user._id);
    const sellerId = String(listing.seller);
    const viewerIsSeller = viewerId === sellerId;
    const requestedBuyerId = String(req.query.buyerId || '').trim();

    let query = { listing: listing._id };
    if (viewerIsSeller) {
        if (!requestedBuyerId) {
            // Seller opening the message hub for this listing without specifying a buyer
            const conversations = await Conversation.find({ listing: listing._id })
                .sort({ lastMessageAt: -1 })
                .populate('buyer', 'name email avatar isVerified')
                .lean();
                
            const summaries = conversations.map(conv => ({
                buyerId: String(conv.buyer._id),
                buyerUser: conv.buyer,
                unreadBySeller: conv.unreadBySeller,
                unreadByBuyer: conv.unreadByBuyer,
                lastMessageAt: conv.lastMessageAt,
                lastMessagePreview: conv.lastMessagePreview,
            }));
            return res.json({ success: true, conversation: null, conversations: summaries });
        }
        query.buyer = requestedBuyerId;
    } else {
        query.buyer = viewerId;
    }

    const conversation = await Conversation.findOne(query)
        .populate('seller', 'name email avatar isVerified')
        .populate('buyer', 'name email avatar isVerified');

    if (!conversation) {
        return res.json({ success: true, conversation: null });
    }

    // Mark unread as 0
    let hasUnread = false;
    if (viewerIsSeller && conversation.unreadBySeller > 0) {
        conversation.unreadBySeller = 0;
        hasUnread = true;
    } else if (!viewerIsSeller && conversation.unreadByBuyer > 0) {
        conversation.unreadByBuyer = 0;
        hasUnread = true;
    }

    if (hasUnread) await conversation.save();

    // Mark messages as read
    const readAt = new Date();
    await Message.updateMany(
        { 
            conversation: conversation._id, 
            sender: { $ne: req.user._id }, 
            readAt: null 
        },
        { $set: { readAt } }
    );

    // Fetch chronological messages
    const messages = await Message.find({ conversation: conversation._id })
        .sort({ sentAt: 1 })
        .lean();

    const counterpartPayload = {
        listing,
        buyerId: String(conversation.buyer._id),
        sellerId: String(conversation.seller._id),
        sellerUser: viewerIsSeller ? null : conversation.seller,
        buyerUser: viewerIsSeller ? conversation.buyer : null,
        unreadCount: 0,
        lastMessageAt: conversation.lastMessageAt,
        lastMessagePreview: conversation.lastMessagePreview,
        messages: messages.map(m => ({
            ...m,
            sender: String(m.sender)
        }))
    };

    return res.json({ success: true, conversation: counterpartPayload });
});

/**
 * @desc    Send a persistent marketplace message to listing seller/buyer
 * @route   POST /api/listings/:id/messages
 * @access  Private
 */
const sendListingMessage = asyncHandler(async (req, res, next) => {
    const listing = await Listing.findById(req.params.id)
        .select('title price images status seller')
        .lean();

    if (!listing) {
        return next(new AppError('Listing not found', 404));
    }

    const text = normalizeMessageText(req.body?.text);
    if (!text) {
        return next(new AppError('Message text is required', 400));
    }
    if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
        return next(new AppError(`Message is too long (max ${MAX_CHAT_MESSAGE_LENGTH} characters)`, 400));
    }

    const viewerId = String(req.user._id);
    const sellerId = String(listing.seller);
    const viewerIsSeller = viewerId === sellerId;
    let buyerId = viewerId;

    if (viewerIsSeller) {
        buyerId = String(req.body?.buyerId || '').trim();
        if (!buyerId || !isValidObjectId(buyerId)) {
            return next(new AppError('Valid buyerId is required when seller sends a message', 400));
        }
        if (buyerId === sellerId) {
            return next(new AppError('Seller cannot message self', 400));
        }
    }

    // Upsert conversation
    const sentAt = new Date();
    const conversation = await Conversation.findOneAndUpdate(
        { listing: listing._id, buyer: buyerId },
        {
            $setOnInsert: {
                seller: sellerId,
            },
            $set: {
                lastMessageAt: sentAt,
                lastMessagePreview: text.slice(0, 180),
            },
            $inc: {
                unreadBySeller: viewerIsSeller ? 0 : 1,
                unreadByBuyer: viewerIsSeller ? 1 : 0,
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Insert Message
    const messageDoc = await Message.create({
        conversation: conversation._id,
        sender: viewerId,
        senderRole: viewerIsSeller ? 'seller' : 'buyer',
        text,
        sentAt,
    });

    // Emit real-time WebSocket event to the recipient
    sendMessageToUser(viewerIsSeller ? buyerId : sellerId, 'new_message', {
        listingId: String(listing._id),
        message: {
            ...messageDoc.toObject(),
            sender: String(messageDoc.sender)
        }
    });

    const users = await User.find({ _id: { $in: [sellerId, buyerId] } })
        .select('name email avatar isVerified')
        .lean();
    const userMap = new Map(users.map((user) => [String(user._id), user]));
    
    const sellerLookupId = sellerId;
    const buyerLookupId = String(buyerId);
    
    const formattedConversation = {
        listing,
        buyerId: String(conversation.buyer),
        sellerId: String(conversation.seller),
        sellerUser: viewerIsSeller ? null : userMap.get(sellerLookupId),
        buyerUser: viewerIsSeller ? userMap.get(buyerLookupId) : null,
        unreadCount: 0,
        lastMessageAt: conversation.lastMessageAt,
        lastMessagePreview: conversation.lastMessagePreview,
        messages: [{
            ...messageDoc.toObject(),
            sender: String(messageDoc.sender)
        }]
    };

    const recipientUser = viewerIsSeller ? userMap.get(buyerLookupId) : userMap.get(sellerLookupId);
    const actorName = String(req.user?.name || req.user?.email || 'A marketplace user').trim();

    sendCounterpartyMessageEmail({
        recipientEmail: recipientUser?.email || '',
        recipientName: recipientUser?.name || '',
        actorName,
        listing,
        messageText: text,
        req,
    }).catch((error) => {
        logger.warn('listing.message_counterparty_email_failed', {
            listingId: String(listing._id),
            senderId: viewerId,
            recipientId: viewerIsSeller ? buyerLookupId : sellerLookupId,
            error: error.message,
        });
    });

    res.json({
        success: true,
        message: 'Message sent',
        conversation: formattedConversation,
    });
});

const startEscrow = asyncHandler(async (req, res, next) => {
    const listing = await Listing.findById(req.params.id).populate('seller', SELLER_PUBLIC);
    try {
        assertEscrowEligibility({ listing, userId: req.user._id, allowHeld: false });
    } catch (error) {
        return next(error);
    }

    const paymentIntentId = String(req.body?.paymentIntentId || '').trim();
    if (!paymentIntentId) {
        return next(new AppError('paymentIntentId is required to start escrow', 400));
    }

    const intent = await PaymentIntent.findOne({ intentId: paymentIntentId, user: req.user._id });
    if (!intent) {
        return next(new AppError('Escrow payment intent not found for this user', 404));
    }
    if (String(intent.metadata?.purpose || '') !== ESCROW_PAYMENT_PURPOSE) {
        return next(new AppError('Payment intent is not valid for marketplace escrow', 409));
    }
    if (String(intent.metadata?.listingId || '') !== String(listing._id)) {
        return next(new AppError('Payment intent does not match this listing', 409));
    }
    if (String(intent.metadata?.sellerId || '') !== String(listing.seller?._id || listing.seller)) {
        return next(new AppError('Payment intent seller mismatch', 409));
    }
    if (isIntentExpired(intent)) {
        intent.status = PAYMENT_STATUSES.EXPIRED;
        await intent.save();
        return next(new AppError('Escrow payment intent expired. Restart payment flow.', 409));
    }
    if (![PAYMENT_STATUSES.AUTHORIZED, PAYMENT_STATUSES.CAPTURED].includes(intent.status)) {
        return next(new AppError('Payment intent is not authorized for escrow hold', 409));
    }

    const listingPrice = roundCurrency(listing.price || 0);
    if (diff(intent.amount, listingPrice) > 0.01) {
        return next(new AppError('Payment amount mismatch with listing price', 409));
    }

    listing.escrow = {
        enabled: true,
        state: 'held',
        buyer: req.user._id,
        amount: listingPrice,
        holdReference: `ESC-${intent.intentId}`,
        paymentIntentId: intent.intentId,
        paymentProvider: intent.provider || '',
        paymentState: intent.status,
        paymentAuthorizedAt: intent.authorizedAt || null,
        paymentCapturedAt: intent.capturedAt || null,
        refundReference: '',
        refundedAt: null,
        startedAt: new Date(),
        confirmedAt: null,
        releasedAt: null,
    };

    await listing.save();
    await appendEscrowPaymentEvent({
        intentId: intent.intentId,
        source: 'api',
        type: 'marketplace.escrow.hold_started',
        payload: {
            listingId: String(listing._id),
            buyerId: String(req.user._id),
            amount: listingPrice,
        },
    });

    return res.json({
        success: true,
        message: 'Escrow hold created. Payment is now locked until buyer confirms delivery.',
        listing,
    });
});

const confirmEscrowDelivery = asyncHandler(async (req, res, next) => {
    const listing = await Listing.findById(req.params.id).populate('seller', SELLER_PUBLIC);
    if (!listing) return next(new AppError('Listing not found', 404));

    if (listing.escrow?.state !== 'held') {
        return next(new AppError('No active escrow hold found for this listing', 409));
    }
    if (String(listing.escrow?.buyer || '') !== String(req.user._id)) {
        return next(new AppError('Only escrow buyer can confirm delivery', 403));
    }

    const paymentIntentId = String(listing.escrow?.paymentIntentId || '').trim();
    if (!paymentIntentId) {
        return next(new AppError('Escrow hold is missing payment intent reference', 409));
    }

    const intent = await PaymentIntent.findOne({ intentId: paymentIntentId, user: listing.escrow.buyer });
    if (!intent) {
        return next(new AppError('Escrow payment intent no longer exists', 409));
    }

    if (isIntentExpired(intent) && intent.status !== PAYMENT_STATUSES.CAPTURED) {
        intent.status = PAYMENT_STATUSES.EXPIRED;
        await intent.save();
        return next(new AppError('Escrow payment authorization expired. Please restart transaction.', 409));
    }

    let finalIntent = intent;
    if (intent.status === PAYMENT_STATUSES.AUTHORIZED) {
        finalIntent = await captureIntentNow({ intentId: paymentIntentId });
    } else if (intent.status !== PAYMENT_STATUSES.CAPTURED) {
        return next(new AppError(`Escrow payment is in invalid state: ${intent.status}`, 409));
    }

    listing.escrow.state = 'released';
    listing.escrow.confirmedAt = new Date();
    listing.escrow.releasedAt = new Date();
    listing.escrow.paymentState = finalIntent.status;
    listing.escrow.paymentCapturedAt = finalIntent.capturedAt || new Date();
    listing.status = 'sold';
    listing.soldAt = new Date();

    await listing.save();
    await appendEscrowPaymentEvent({
        intentId: paymentIntentId,
        source: 'api',
        type: 'marketplace.escrow.released',
        payload: {
            listingId: String(listing._id),
            buyerId: String(req.user._id),
            releasedAt: new Date().toISOString(),
        },
    });

    return res.json({
        success: true,
        message: 'Delivery confirmed. Payment captured and escrow released to seller.',
        listing,
    });
});

const cancelEscrow = asyncHandler(async (req, res, next) => {
    const listing = await Listing.findById(req.params.id).populate('seller', SELLER_PUBLIC);
    if (!listing) return next(new AppError('Listing not found', 404));

    if (listing.escrow?.state !== 'held') {
        return next(new AppError('No active escrow hold to cancel', 409));
    }

    const isBuyer = String(listing.escrow?.buyer || '') === String(req.user._id);
    const isSeller = String(listing.seller?._id || listing.seller) === String(req.user._id);
    if (!isBuyer && !isSeller) {
        return next(new AppError('Not authorized to cancel this escrow hold', 403));
    }

    const paymentIntentId = String(listing.escrow?.paymentIntentId || '').trim();
    if (paymentIntentId) {
        const intent = await PaymentIntent.findOne({ intentId: paymentIntentId, user: listing.escrow?.buyer });
        if (intent) {
            if (intent.status === PAYMENT_STATUSES.CAPTURED) {
                if (!intent.providerPaymentId) {
                    return next(new AppError('Captured escrow payment is missing provider payment reference', 409));
                }

                const provider = await getPaymentProvider({
                    amount: intent.amount,
                    currency: intent.currency,
                    paymentMethod: intent.method,
                    userId: intent.user,
                });
                const providerRefund = await provider.refund({
                    paymentId: intent.providerPaymentId,
                    amount: intent.amount,
                    notes: {
                        reason: 'marketplace_escrow_cancelled',
                        listingId: String(listing._id),
                        cancelledBy: String(req.user._id),
                    },
                });

                intent.status = PAYMENT_STATUSES.REFUNDED;
                await intent.save();
                await appendEscrowPaymentEvent({
                    intentId: paymentIntentId,
                    source: 'api',
                    type: 'marketplace.escrow.refunded',
                    payload: {
                        listingId: String(listing._id),
                        refundId: providerRefund.id || '',
                        amount: intent.amount,
                    },
                });

                listing.escrow.paymentState = PAYMENT_STATUSES.REFUNDED;
                listing.escrow.refundReference = String(providerRefund.id || '');
                listing.escrow.refundedAt = new Date();
            } else if (
                intent.status === PAYMENT_STATUSES.AUTHORIZED
                || intent.status === PAYMENT_STATUSES.CREATED
                || intent.status === PAYMENT_STATUSES.CHALLENGE_PENDING
            ) {
                intent.status = PAYMENT_STATUSES.EXPIRED;
                await intent.save();
                await appendEscrowPaymentEvent({
                    intentId: paymentIntentId,
                    source: 'api',
                    type: 'marketplace.escrow.authorization_released',
                    payload: {
                        listingId: String(listing._id),
                        cancelledBy: String(req.user._id),
                    },
                });
                listing.escrow.paymentState = PAYMENT_STATUSES.EXPIRED;
            }
        }
    }

    listing.escrow.state = 'cancelled';
    listing.escrow.enabled = true;
    listing.escrow.confirmedAt = null;
    listing.escrow.releasedAt = null;
    listing.status = 'active';
    listing.soldAt = null;
    if (!isBuyer) {
        listing.disputeCount = (Number(listing.disputeCount) || 0) + 1;
    }

    await listing.save();
    return res.json({
        success: true,
        message: 'Escrow cancelled and listing re-opened.',
        listing,
    });
});

module.exports = {
    createListing, getListings, getListingById,
    updateListing, markSold, deleteListing,
    getMyListings, getSellerProfile,
    getMyMessageInbox, getListingMessages, sendListingMessage,
    createEscrowIntent, confirmEscrowIntent,
    startEscrow, confirmEscrowDelivery, cancelEscrow,
    getCityHotspots,
};
