const asyncHandler = require('express-async-handler');
const PriceAlert = require('../models/PriceAlert');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');

// @desc    Create price alert
// @route   POST /api/price-alerts
// @access  Private
const createPriceAlert = asyncHandler(async (req, res, next) => {
    const { productId, targetPrice } = req.body;

    const product = await Product.findOne({ id: productId }).lean();
    if (!product) return next(new AppError('Product not found', 404));

    if (targetPrice >= product.price) {
        return next(new AppError('Target price must be lower than current price', 400));
    }

    // Check for existing active alert
    const existing = await PriceAlert.findOne({
        user: req.user._id, productId, isActive: true
    });
    if (existing) {
        // Update target price
        existing.targetPrice = targetPrice;
        existing.currentPrice = product.price;
        await existing.save();
        return res.json({ success: true, alert: existing, updated: true });
    }

    const alert = await PriceAlert.create({
        user: req.user._id,
        productId,
        productTitle: product.title,
        productImage: product.image,
        currentPrice: product.price,
        targetPrice
    });

    res.status(201).json({ success: true, alert });
});

// @desc    Get my alerts
// @route   GET /api/price-alerts/my
// @access  Private
const getMyAlerts = asyncHandler(async (req, res) => {
    const alerts = await PriceAlert.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .lean();

    // Fetch current prices for active alerts
    const activeAlerts = alerts.filter(a => a.isActive);
    if (activeAlerts.length > 0) {
        const productIds = activeAlerts.map(a => a.productId);
        const products = await Product.find({ id: { $in: productIds } }, 'id price').lean();
        const priceMap = {};
        products.forEach(p => { priceMap[p.id] = p.price; });

        alerts.forEach(a => {
            if (priceMap[a.productId] !== undefined) {
                a.latestPrice = priceMap[a.productId];
                // Check if price dropped below target
                if (a.isActive && priceMap[a.productId] <= a.targetPrice) {
                    a.triggered = true;
                }
            }
        });
    }

    res.json({ success: true, alerts });
});

// @desc    Delete alert
// @route   DELETE /api/price-alerts/:id
// @access  Private
const deleteAlert = asyncHandler(async (req, res, next) => {
    const alert = await PriceAlert.findOne({ _id: req.params.id, user: req.user._id });
    if (!alert) return next(new AppError('Alert not found', 404));
    await alert.deleteOne();
    res.json({ success: true, message: 'Alert deleted' });
});

// @desc    Get price history for a product
// @route   GET /api/price-alerts/history/:productId
// @access  Public
const getPriceHistory = asyncHandler(async (req, res) => {
    const productId = parseInt(req.params.productId);
    const product = await Product.findOne({ id: productId }, 'id title price originalPrice priceHistory').lean();

    if (!product) return res.json({ success: true, history: [] });

    // Generate synthetic history from available data if no priceHistory exists
    const history = product.priceHistory || [];

    if (history.length === 0) {
        // Create synthetic 30-day history based on current/original price
        const now = Date.now();
        const original = product.originalPrice || product.price * 1.15;
        const current = product.price;
        const synth = [];
        for (let i = 30; i >= 0; i--) {
            const date = new Date(now - i * 86400000).toISOString().split('T')[0];
            // Simulate gradual price drop with some noise
            const progress = (30 - i) / 30;
            const noise = (Math.sin(i * 1.7) * 0.05);
            const price = Math.round(original - (original - current) * (progress + noise));
            synth.push({ date, price: Math.max(price, current) });
        }
        return res.json({ success: true, history: synth, synthetic: true });
    }

    res.json({ success: true, history });
});

module.exports = { createPriceAlert, getMyAlerts, deleteAlert, getPriceHistory };
