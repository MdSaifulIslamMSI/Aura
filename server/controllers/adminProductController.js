const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const User = require('../models/User');
const ProductGovernanceLog = require('../models/ProductGovernanceLog');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
    createManualProduct,
    updateManualProduct,
    deleteManualProduct,
} = require('../services/catalogService');

const ADMIN_PRODUCT_FIELDS = {
    id: 1,
    externalId: 1,
    source: 1,
    catalogVersion: 1,
    isPublished: 1,
    title: 1,
    brand: 1,
    category: 1,
    subCategory: 1,
    price: 1,
    originalPrice: 1,
    discountPercentage: 1,
    image: 1,
    stock: 1,
    rating: 1,
    ratingCount: 1,
    description: 1,
    highlights: 1,
    specifications: 1,
    deliveryTime: 1,
    warranty: 1,
    adCampaign: 1,
    createdAt: 1,
    updatedAt: 1,
};

const makeActionId = (prefix = 'pgl') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const sanitizeReason = (value, fallback = '') => {
    const normalized = String(value || '').trim();
    return normalized || fallback;
};

const buildLookupFilter = (identifier) => {
    const trimmed = String(identifier || '').trim();
    const numeric = Number(trimmed);
    const or = [{ externalId: trimmed }];
    if (Number.isFinite(numeric)) {
        or.push({ id: numeric });
    }
    if (mongoose.isValidObjectId(trimmed)) {
        or.push({ _id: trimmed });
    }
    return { $or: or };
};

const resolveProductForAdmin = async (identifier) => Product.findOne(buildLookupFilter(identifier))
    .sort({ isPublished: -1, updatedAt: -1 });

const productToAdminJson = (product) => {
    if (!product) return null;
    return {
        _id: String(product._id),
        id: Number(product.id || 0),
        externalId: product.externalId || '',
        source: product.source || '',
        catalogVersion: product.catalogVersion || '',
        isPublished: Boolean(product.isPublished),
        title: product.title || '',
        brand: product.brand || '',
        category: product.category || '',
        subCategory: product.subCategory || '',
        price: Number(product.price || 0),
        originalPrice: Number(product.originalPrice || 0),
        discountPercentage: Number(product.discountPercentage || 0),
        image: product.image || '',
        stock: Number(product.stock || 0),
        rating: Number(product.rating || 0),
        ratingCount: Number(product.ratingCount || 0),
        description: product.description || '',
        highlights: Array.isArray(product.highlights) ? product.highlights : [],
        specifications: Array.isArray(product.specifications) ? product.specifications : [],
        deliveryTime: product.deliveryTime || '',
        warranty: product.warranty || '',
        adCampaign: product.adCampaign || {},
        createdAt: product.createdAt || null,
        updatedAt: product.updatedAt || null,
    };
};

const loadPersistedProductById = async (id) => {
    if (!id) return null;
    return Product.findById(id).select(ADMIN_PRODUCT_FIELDS);
};

const propagateProductSnapshotToUserCollections = async (productDoc) => {
    const productId = Number(productDoc?.id);
    if (!Number.isFinite(productId) || productId <= 0) return;

    const cartSnapshot = {
        title: String(productDoc.title || ''),
        price: Number(productDoc.price || 0),
        image: String(productDoc.image || ''),
        stock: Number(productDoc.stock || 0),
        brand: String(productDoc.brand || ''),
        discountPercentage: Number(productDoc.discountPercentage || 0),
        originalPrice: Number(productDoc.originalPrice || productDoc.price || 0),
    };
    const wishlistSnapshot = {
        title: cartSnapshot.title,
        price: cartSnapshot.price,
        image: cartSnapshot.image,
        stock: cartSnapshot.stock,
        brand: cartSnapshot.brand,
        rating: Number(productDoc.rating || 0),
        ratingCount: Number(productDoc.ratingCount || 0),
    };

    const [cartResult, wishlistResult] = await Promise.all([
        User.updateMany(
            { 'cart.id': productId },
            {
                $set: {
                    'cart.$[item].title': cartSnapshot.title,
                    'cart.$[item].price': cartSnapshot.price,
                    'cart.$[item].image': cartSnapshot.image,
                    'cart.$[item].stock': cartSnapshot.stock,
                    'cart.$[item].brand': cartSnapshot.brand,
                    'cart.$[item].discountPercentage': cartSnapshot.discountPercentage,
                    'cart.$[item].originalPrice': cartSnapshot.originalPrice,
                },
            },
            { arrayFilters: [{ 'item.id': productId }] }
        ),
        User.updateMany(
            { 'wishlist.id': productId },
            {
                $set: {
                    'wishlist.$[item].title': wishlistSnapshot.title,
                    'wishlist.$[item].price': wishlistSnapshot.price,
                    'wishlist.$[item].image': wishlistSnapshot.image,
                    'wishlist.$[item].stock': wishlistSnapshot.stock,
                    'wishlist.$[item].brand': wishlistSnapshot.brand,
                    'wishlist.$[item].rating': wishlistSnapshot.rating,
                    'wishlist.$[item].ratingCount': wishlistSnapshot.ratingCount,
                },
            },
            { arrayFilters: [{ 'item.id': productId }] }
        ),
    ]);

    logger.info('admin_product.user_collections_refreshed', {
        productId,
        cartUsersModified: Number(cartResult?.modifiedCount || cartResult?.nModified || 0),
        wishlistUsersModified: Number(wishlistResult?.modifiedCount || wishlistResult?.nModified || 0),
    });
};

const removeProductFromUserCollections = async (productDoc) => {
    const productId = Number(productDoc?.id);
    if (!Number.isFinite(productId) || productId <= 0) return;

    const [cartResult, wishlistResult] = await Promise.all([
        User.updateMany(
            { 'cart.id': productId },
            { $pull: { cart: { id: productId } } }
        ),
        User.updateMany(
            { 'wishlist.id': productId },
            { $pull: { wishlist: { id: productId } } }
        ),
    ]);

    logger.info('admin_product.user_collections_removed', {
        productId,
        cartUsersModified: Number(cartResult?.modifiedCount || cartResult?.nModified || 0),
        wishlistUsersModified: Number(wishlistResult?.modifiedCount || wishlistResult?.nModified || 0),
    });
};

const getSnapshot = (productDoc) => {
    if (!productDoc) return null;
    const product = productDoc.toObject ? productDoc.toObject() : productDoc;
    return {
        _id: product._id ? String(product._id) : null,
        id: Number(product.id || 0),
        externalId: product.externalId || '',
        source: product.source || '',
        catalogVersion: product.catalogVersion || '',
        title: product.title || '',
        brand: product.brand || '',
        category: product.category || '',
        subCategory: product.subCategory || '',
        price: Number(product.price || 0),
        originalPrice: Number(product.originalPrice || 0),
        discountPercentage: Number(product.discountPercentage || 0),
        image: product.image || '',
        stock: Number(product.stock || 0),
        description: product.description || '',
        highlights: Array.isArray(product.highlights) ? product.highlights : [],
        specifications: Array.isArray(product.specifications) ? product.specifications : [],
        deliveryTime: product.deliveryTime || '',
        warranty: product.warranty || '',
        adCampaign: product.adCampaign || {},
        updatedAt: product.updatedAt || null,
    };
};

const deriveChangeSet = (beforeSnapshot, afterSnapshot) => {
    const keys = [
        'title',
        'brand',
        'category',
        'subCategory',
        'price',
        'originalPrice',
        'discountPercentage',
        'image',
        'stock',
        'description',
        'highlights',
        'specifications',
        'deliveryTime',
        'warranty',
        'adCampaign',
    ];
    const changes = {};
    keys.forEach((key) => {
        const beforeValue = beforeSnapshot?.[key];
        const afterValue = afterSnapshot?.[key];
        if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
            changes[key] = { before: beforeValue, after: afterValue };
        }
    });
    return changes;
};

const isCollectionQuotaError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('cannot create a new collection')
        && message.includes('collections');
};

const writeGovernanceLog = async ({
    actionType,
    req,
    productDoc,
    productRef,
    reason = '',
    beforeSnapshot = null,
    afterSnapshot = null,
}) => {
    try {
        return await ProductGovernanceLog.create({
            actionId: makeActionId(),
            product: productDoc?._id || null,
            productRef: String(productRef || productDoc?.id || productDoc?.externalId || ''),
            actionType,
            actorUser: req.user?._id,
            actorEmail: req.user?.email || '',
            reason: sanitizeReason(reason, ''),
            beforeSnapshot,
            afterSnapshot,
            changeSet: deriveChangeSet(beforeSnapshot, afterSnapshot),
        });
    } catch (error) {
        if (isCollectionQuotaError(error)) {
            logger.warn('admin_product.governance_log_skipped', {
                actionType,
                reason: 'collection_quota_reached',
                productRef: String(productRef || productDoc?.id || productDoc?.externalId || ''),
            });
            return null;
        }
        throw error;
    }
};

const parsePagination = (req) => {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);
    return { page, limit, skip: (page - 1) * limit };
};

// @desc    List products for admin portal control
// @route   GET /api/admin/products
// @access  Private/Admin
const listAdminProducts = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};

    const search = String(req.query.search || '').trim();
    if (search) {
        const numericSearch = Number(search);
        const numericClause = Number.isFinite(numericSearch)
            ? [{ id: numericSearch }]
            : [];
        // CRITICAL: Escape regex special characters to prevent injection
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
            { title: { $regex: escapedSearch, $options: 'i' } },
            { brand: { $regex: escapedSearch, $options: 'i' } },
            { category: { $regex: escapedSearch, $options: 'i' } },
            { externalId: { $regex: escapedSearch, $options: 'i' } },
            ...numericClause,
        ];
    }
    if (req.query.source) filter.source = req.query.source;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.brand) filter.brand = req.query.brand;

    const sortKey = String(req.query.sort || 'newest').toLowerCase();
    const sortMap = {
        newest: { updatedAt: -1 },
        oldest: { updatedAt: 1 },
        'price-asc': { price: 1, updatedAt: -1 },
        'price-desc': { price: -1, updatedAt: -1 },
        'stock-asc': { stock: 1, updatedAt: -1 },
        'stock-desc': { stock: -1, updatedAt: -1 },
    };
    const sort = sortMap[sortKey] || sortMap.newest;

    const [products, total] = await Promise.all([
        Product.find(filter)
            .select(ADMIN_PRODUCT_FIELDS)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        Product.countDocuments(filter),
    ]);

    res.json({
        success: true,
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        products: (products || []).map(productToAdminJson),
    });
});

// @desc    Get single product for admin control
// @route   GET /api/admin/products/:id
// @access  Private/Admin
const getAdminProductById = asyncHandler(async (req, res, next) => {
    const product = await resolveProductForAdmin(req.params.id);
    if (!product) return next(new AppError('Product not found', 404));

    const logsFilter = {
        $or: [
            { product: product._id },
            { productRef: String(product.id || '') },
            { productRef: String(product.externalId || '') },
        ],
    };
    const logs = await ProductGovernanceLog.find(logsFilter)
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

    res.json({
        success: true,
        product: productToAdminJson(product),
        logs: logs.map((log) => ({
            actionId: log.actionId,
            actionType: log.actionType,
            actorEmail: log.actorEmail || '',
            reason: log.reason || '',
            createdAt: log.createdAt || null,
            changeSet: log.changeSet || {},
        })),
    });
});

// @desc    Create product via admin portal
// @route   POST /api/admin/products
// @access  Private/Admin
const createAdminProduct = asyncHandler(async (req, res) => {
    const payload = {
        ...req.body,
        stock: req.body.countInStock ?? req.body.stock ?? 0,
    };
    const created = await createManualProduct(payload);
    const persisted = await loadPersistedProductById(created?._id);
    if (!persisted) {
        throw new AppError('Product persistence verification failed after create', 500);
    }
    const afterSnapshot = getSnapshot(persisted);

    await writeGovernanceLog({
        actionType: 'create',
        req,
        productDoc: persisted,
        productRef: persisted?.id || persisted?.externalId,
        reason: sanitizeReason(req.body?.reason, 'Admin product creation'),
        beforeSnapshot: null,
        afterSnapshot,
    });

    res.status(201).json({
        success: true,
        message: 'Product created successfully',
        product: productToAdminJson(persisted),
    });
});

// @desc    Update product core fields via admin portal
// @route   PATCH /api/admin/products/:id/core
// @access  Private/Admin
const updateAdminProductCore = asyncHandler(async (req, res, next) => {
    const existing = await resolveProductForAdmin(req.params.id);
    if (!existing) return next(new AppError('Product not found', 404));

    const beforeSnapshot = getSnapshot(existing);
    const payload = {
        ...req.body,
        stock: req.body.countInStock ?? req.body.stock,
    };
    delete payload.reason;

    // Use resolved Mongo _id to avoid catalog-version filter mismatches in downstream service lookup.
    const updated = await updateManualProduct(String(existing._id), payload);
    const persisted = await loadPersistedProductById(updated?._id || existing._id);
    if (!persisted) {
        throw new AppError('Product persistence verification failed after core update', 500);
    }
    const afterSnapshot = getSnapshot(persisted);

    await writeGovernanceLog({
        actionType: 'update_core',
        req,
        productDoc: persisted,
        productRef: persisted?.id || persisted?.externalId || req.params.id,
        reason: sanitizeReason(req.body?.reason, 'Admin core product update'),
        beforeSnapshot,
        afterSnapshot,
    });

    try {
        await propagateProductSnapshotToUserCollections(persisted);
    } catch (error) {
        logger.warn('admin_product.cart_projection_refresh_failed', {
            productId: Number(persisted?.id || 0),
            error: String(error?.message || 'unknown').slice(0, 200),
        });
    }

    res.json({
        success: true,
        message: 'Product core details updated',
        product: productToAdminJson(persisted),
    });
});

// @desc    Update product pricing via admin portal
// @route   PATCH /api/admin/products/:id/pricing
// @access  Private/Admin
const updateAdminProductPricing = asyncHandler(async (req, res, next) => {
    const existing = await resolveProductForAdmin(req.params.id);
    if (!existing) return next(new AppError('Product not found', 404));

    const beforeSnapshot = getSnapshot(existing);
    const price = Number(req.body.price);
    const originalPriceRaw = req.body.originalPrice !== undefined
        ? Number(req.body.originalPrice)
        : Number(existing.originalPrice || price);
    const originalPrice = originalPriceRaw > 0 ? originalPriceRaw : price;

    if (price > originalPrice) {
        return next(new AppError('Selling price cannot be greater than original price', 400));
    }

    const providedDiscount = req.body.discountPercentage !== undefined
        ? Number(req.body.discountPercentage)
        : null;
    const computedDiscount = originalPrice > 0
        ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
        : 0;

    const payload = {
        price,
        originalPrice,
        discountPercentage: providedDiscount !== null
            ? Math.min(Math.max(providedDiscount, 0), 100)
            : Math.min(Math.max(computedDiscount, 0), 100),
    };

    // Use resolved Mongo _id to avoid catalog-version filter mismatches in downstream service lookup.
    const updated = await updateManualProduct(String(existing._id), payload);
    const persisted = await loadPersistedProductById(updated?._id || existing._id);
    if (!persisted) {
        throw new AppError('Product persistence verification failed after pricing update', 500);
    }
    const afterSnapshot = getSnapshot(persisted);

    await writeGovernanceLog({
        actionType: 'update_pricing',
        req,
        productDoc: persisted,
        productRef: persisted?.id || persisted?.externalId || req.params.id,
        reason: sanitizeReason(req.body.reason, 'Admin pricing update'),
        beforeSnapshot,
        afterSnapshot,
    });

    try {
        await propagateProductSnapshotToUserCollections(persisted);
    } catch (error) {
        logger.warn('admin_product.cart_projection_refresh_failed', {
            productId: Number(persisted?.id || 0),
            error: String(error?.message || 'unknown').slice(0, 200),
        });
    }

    res.json({
        success: true,
        message: 'Product pricing updated',
        product: productToAdminJson(persisted),
    });
});

// @desc    Delete product via admin portal
// @route   DELETE /api/admin/products/:id
// @access  Private/Admin
const deleteAdminProduct = asyncHandler(async (req, res, next) => {
    const existing = await resolveProductForAdmin(req.params.id);
    if (!existing) return next(new AppError('Product not found', 404));

    const beforeSnapshot = getSnapshot(existing);
    const productRef = existing.id || existing.externalId || req.params.id;
    
    // CRITICAL: Cleanup all related data before deletion to prevent orphaning
    try {
        // Cleanup product references from orders/carts
        await Promise.all([
            // Remove from user carts
            require('../models/User').updateMany(
                { 'cart._id': existing._id },
                { $pull: { cart: { _id: existing._id } } }
            ),
            // Remove from wishlists
            require('../models/User').updateMany(
                { 'wishlist': existing._id },
                { $pull: { wishlist: existing._id } }
            ),
        ]);
    } catch (cleanupError) {
        logger.warn('admin_product.cleanup_failed', { productId: existing._id, error: String(cleanupError?.message || '') });
    }
    
    // Use resolved Mongo _id so admin delete is not blocked by catalog-version filters.
    const result = await deleteManualProduct(String(existing._id));

    await writeGovernanceLog({
        actionType: 'delete',
        req,
        productDoc: existing,
        productRef,
        reason: sanitizeReason(req.body?.reason, 'Admin product delete'),
        beforeSnapshot,
        afterSnapshot: null,
    });

    try {
        await removeProductFromUserCollections(existing);
    } catch (error) {
        logger.warn('admin_product.user_collections_cleanup_failed', {
            productId: Number(existing?.id || 0),
            error: String(error?.message || 'unknown').slice(0, 200),
        });
    }

    res.json({
        success: true,
        message: result?.message || 'Product removed',
    });
});

// @desc    Get product governance logs
// @route   GET /api/admin/products/:id/logs
// @access  Private/Admin
const getAdminProductLogs = asyncHandler(async (req, res) => {
    const product = await resolveProductForAdmin(req.params.id);
    const productRef = String(product?.id || product?.externalId || req.params.id);
    const logsFilter = product
        ? {
            $or: [
                { product: product._id },
                { productRef: String(product.id || '') },
                { productRef: String(product.externalId || '') },
            ],
        }
        : { productRef };
    const logs = await ProductGovernanceLog.find(logsFilter)
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

    res.json({
        success: true,
        productRef,
        logs: logs.map((log) => ({
            actionId: log.actionId,
            actionType: log.actionType,
            actorEmail: log.actorEmail || '',
            reason: log.reason || '',
            createdAt: log.createdAt || null,
            changeSet: log.changeSet || {},
            beforeSnapshot: log.beforeSnapshot || null,
            afterSnapshot: log.afterSnapshot || null,
        })),
    });
});

module.exports = {
    listAdminProducts,
    getAdminProductById,
    createAdminProduct,
    updateAdminProductCore,
    updateAdminProductPricing,
    deleteAdminProduct,
    getAdminProductLogs,
};
