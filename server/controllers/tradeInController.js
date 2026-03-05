const asyncHandler = require('express-async-handler');
const TradeIn = require('../models/TradeIn');
const Product = require('../models/Product');
const Listing = require('../models/Listing');
const AppError = require('../utils/AppError');

// Condition-based value multipliers (% of original product price)
const CONDITION_MULTIPLIERS = {
    'new': 0.70,
    'like-new': 0.55,
    'good': 0.40,
    'fair': 0.25,
    'poor': 0.10
};

// @desc    Estimate trade-in value
// @route   POST /api/trade-in/estimate
// @access  Private
const estimateTradeIn = asyncHandler(async (req, res, next) => {
    const { listingId, manualItem, targetProductId } = req.body;

    // Get target product
    const product = await Product.findOne({ id: targetProductId }).lean();
    if (!product) return next(new AppError('Target product not found', 404));

    let estimatedValue = 0;
    let itemDetails = {};

    if (listingId) {
        const listing = await Listing.findById(listingId).lean();
        if (!listing) return next(new AppError('Listing not found', 404));
        const multiplier = CONDITION_MULTIPLIERS[listing.condition] || 0.30;
        estimatedValue = Math.round(listing.price * multiplier);
        itemDetails = { title: listing.title, condition: listing.condition, price: listing.price };
    } else if (manualItem) {
        const multiplier = CONDITION_MULTIPLIERS[manualItem.condition] || 0.25;
        // Use a base estimate of category average or manual input
        const basePrice = manualItem.estimatedPrice || product.price * 0.5;
        estimatedValue = Math.round(basePrice * multiplier);
        itemDetails = manualItem;
    } else {
        return next(new AppError('Provide either a listing ID or manual item details', 400));
    }

    // Cap at 50% of target product price
    estimatedValue = Math.min(estimatedValue, Math.round(product.price * 0.50));

    res.json({
        success: true,
        estimate: {
            tradeInItem: itemDetails,
            targetProduct: { id: product.id, title: product.title, price: product.price, image: product.image },
            estimatedValue,
            youPay: product.price - estimatedValue,
            savings: `${Math.round((estimatedValue / product.price) * 100)}%`
        }
    });
});

// @desc    Create trade-in request
// @route   POST /api/trade-in
// @access  Private
const createTradeIn = asyncHandler(async (req, res, next) => {
    const { listingId, manualItem, targetProductId, estimatedValue } = req.body;

    const product = await Product.findOne({ id: targetProductId }).lean();
    if (!product) return next(new AppError('Target product not found', 404));

    // Check for existing pending trade-in for same product
    const existing = await TradeIn.findOne({
        user: req.user._id,
        'targetProduct.productId': targetProductId,
        status: { $in: ['pending', 'under-review'] }
    });
    if (existing) return next(new AppError('You already have a pending trade-in for this product', 400));

    const tradeIn = await TradeIn.create({
        user: req.user._id,
        listing: listingId || undefined,
        manualItem: listingId ? undefined : manualItem,
        targetProduct: {
            productId: product.id,
            title: product.title,
            price: product.price,
            image: product.image
        },
        estimatedValue: estimatedValue || 0,
        status: 'pending'
    });

    res.status(201).json({ success: true, tradeIn });
});

// @desc    Get my trade-ins
// @route   GET /api/trade-in/my
// @access  Private
const getMyTradeIns = asyncHandler(async (req, res) => {
    const tradeIns = await TradeIn.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .populate('listing', 'title images condition price')
        .lean();

    res.json({ success: true, tradeIns });
});

// @desc    Cancel trade-in
// @route   DELETE /api/trade-in/:id
// @access  Private
const cancelTradeIn = asyncHandler(async (req, res, next) => {
    const tradeIn = await TradeIn.findOne({ _id: req.params.id, user: req.user._id });
    if (!tradeIn) return next(new AppError('Trade-in not found', 404));
    if (!['pending', 'under-review'].includes(tradeIn.status)) {
        return next(new AppError('Cannot cancel a trade-in that is already processed', 400));
    }
    await tradeIn.deleteOne();
    res.json({ success: true, message: 'Trade-in cancelled' });
});

module.exports = { estimateTradeIn, createTradeIn, getMyTradeIns, cancelTradeIn };
