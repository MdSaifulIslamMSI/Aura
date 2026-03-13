const crypto = require('crypto');
const Product = require('../models/Product');
const SystemState = require('../models/SystemState');
const AppError = require('../utils/AppError');
const COUPON_RULES = require('../config/coupons');
const { flags: catalogFlags } = require('../config/catalogFlags');
const { calculateOptimalLogisticsCost } = require('./logisticsOptimizer');
const { solveAuraCover } = require('./marketplaceOptimizers');

const PAYMENT_METHODS = ['COD', 'UPI', 'CARD', 'WALLET'];
const DELIVERY_OPTIONS = ['standard', 'express'];
const SLOT_WINDOWS = ['09:00-12:00', '12:00-15:00', '15:00-18:00', '18:00-21:00'];
const PRICING_VERSION = 'v2';

const roundCurrency = (value) => Number((Number(value) || 0).toFixed(2));

const parsePositiveInteger = (value, fieldName) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new AppError(`${fieldName} must be a positive integer`, 400);
    }
    return parsed;
};

const normalizePaymentMethod = (paymentMethod) => {
    const normalized = String(paymentMethod || 'COD').toUpperCase();
    if (!PAYMENT_METHODS.includes(normalized)) {
        throw new AppError(`Unsupported payment method: ${paymentMethod}`, 400);
    }
    return normalized;
};

const normalizeDeliveryOption = (deliveryOption) => {
    const normalized = String(deliveryOption || 'standard').toLowerCase();
    if (!DELIVERY_OPTIONS.includes(normalized)) {
        throw new AppError(`Unsupported delivery option: ${deliveryOption}`, 400);
    }
    return normalized;
};

const normalizeDeliverySlot = (deliverySlot) => {
    if (!deliverySlot) return null;

    const date = String(deliverySlot.date || '').trim();
    const window = String(deliverySlot.window || '').trim();

    if (!date || !window) {
        throw new AppError('Both deliverySlot.date and deliverySlot.window are required', 400);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new AppError('deliverySlot.date must be in YYYY-MM-DD format', 400);
    }

    if (!SLOT_WINDOWS.includes(window)) {
        throw new AppError('Invalid delivery slot window', 400);
    }

    return { date, window };
};

/**
 * NP-Hard: Vehicle Routing Problem with Time Windows (VRPTW) Heuristic
 * Calculates "Marginal Distance" to optimize delivery density.
 */
const calculateOptimalDeliverySlots = (userLocation = {}, regionalDeliveries = []) => {
    const lat = Number(userLocation.lat || 28.6);
    const lng = Number(userLocation.lng || 77.2);

    const scores = SLOT_WINDOWS.map(window => {
        // Find existing deliveries in this window
        const windowDeliveries = regionalDeliveries.filter(d => d.window === window);
        
        if (windowDeliveries.length === 0) {
            return { window, score: 50, label: 'Standard', marginalDist: 5.0 };
        }

        // Calculate marginal distance to the nearest existing delivery in this window
        let minMarginalDist = Infinity;
        windowDeliveries.forEach(d => {
            const dist = Math.sqrt((d.lat - lat)**2 + (d.lng - lng)**2);
            if (dist < minMarginalDist) minMarginalDist = dist;
        });

        // Heuristic: Lower marginal distance = higher efficiency
        const efficiency = Math.max(0, 100 - (minMarginalDist * 20));
        let label = 'Standard';
        if (efficiency > 85) label = 'Eco-Efficient (High Density)';
        else if (efficiency > 70) label = 'Optimized';

        return {
            window,
            score: Math.round(efficiency),
            label,
            marginalDist: Number(minMarginalDist.toFixed(2))
        };
    });

    return scores.sort((a, b) => b.score - a.score);
};

const normalizeShippingAddress = (shippingAddress = {}) => {
    const address = String(shippingAddress.address || shippingAddress.street || '').trim();
    const city = String(shippingAddress.city || '').trim();
    const postalCode = String(shippingAddress.postalCode || shippingAddress.pincode || '').trim();
    const country = String(shippingAddress.country || shippingAddress.state || '').trim();

    if (!address || !city || !postalCode || !country) {
        throw new AppError('Complete shipping address is required', 400);
    }

    return { address, city, postalCode, country };
};

const normalizeOrderItems = (orderItems = []) => {
    if (!Array.isArray(orderItems) || orderItems.length === 0) {
        throw new AppError('No order items', 400);
    }

    const mergedByProduct = new Map();

    for (const item of orderItems) {
        const productIdRaw = item.product ?? item.productId ?? item.id;
        const quantityRaw = item.qty ?? item.quantity ?? 1;

        const productId = parsePositiveInteger(productIdRaw, 'orderItems.product');
        const quantity = parsePositiveInteger(quantityRaw, 'orderItems.quantity');

        const existing = mergedByProduct.get(productId);
        if (existing) {
            existing.quantity += quantity;
        } else {
            mergedByProduct.set(productId, { productId, quantity });
        }
    }

    return Array.from(mergedByProduct.values());
};

const getActiveCatalogProductFilter = async () => {
    if (!catalogFlags.catalogActiveVersionRequired) return {};
    const state = await SystemState.findOne({ key: 'singleton' }).lean();
    if (!state?.activeCatalogVersion) return { isPublished: true };
    return {
        isPublished: true,
        catalogVersion: state.activeCatalogVersion,
    };
};

const normalizeCheckoutPayload = (payload = {}) => {
    const orderItems = normalizeOrderItems(payload.orderItems || []);
    const shippingAddress = normalizeShippingAddress(payload.shippingAddress || {});
    const paymentMethod = normalizePaymentMethod(payload.paymentMethod);
    const deliveryOption = normalizeDeliveryOption(payload.deliveryOption);
    const deliverySlot = normalizeDeliverySlot(payload.deliverySlot);
    const couponCode = String(payload.couponCode || '').trim().toUpperCase();
    const checkoutSource = payload.checkoutSource === 'directBuy' ? 'directBuy' : 'cart';

    return {
        orderItems,
        shippingAddress,
        paymentMethod,
        deliveryOption,
        deliverySlot,
        couponCode,
        checkoutSource,
    };
};

const resolveProductsForItems = async (normalizedItems, { session = null, checkStock = true } = {}) => {
    const resolvedItems = [];
    let itemsPrice = 0;
    const catalogFilter = await getActiveCatalogProductFilter();

    for (const item of normalizedItems) {
        const query = Product.findOne({ id: item.productId, ...catalogFilter });
        const product = session ? await query.session(session) : await query;

        if (!product) {
            throw new AppError(`Product not found: ${item.productId}`, 404);
        }

        if (checkStock && product.stock < item.quantity) {
            throw new AppError(
                `Insufficient stock for ${product.title}. Available: ${product.stock}, Requested: ${item.quantity}`,
                400
            );
        }

        const unitPrice = Number(product.price) || 0;
        const lineTotal = roundCurrency(unitPrice * item.quantity);
        itemsPrice = roundCurrency(itemsPrice + lineTotal);

        resolvedItems.push({
            productId: item.productId,
            quantity: item.quantity,
            title: product.title,
            image: product.image,
            price: unitPrice,
            mongoProductId: product._id,
            stock: product.stock,
            lineTotal,
            // Simulating seller location for the demo
            sellerLocation: {
                city: ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Hyderabad'][product.id % 5],
                state: ['Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'Telangana'][product.id % 5]
            }
        });
    }

    return { resolvedItems, itemsPrice };
};

const evaluateCoupon = ({ couponCode, itemsPrice, shippingPrice, paymentMethod }) => {
    if (!couponCode) {
        return { couponDiscount: 0, appliedCoupon: null };
    }

    const coupon = COUPON_RULES[couponCode];
    if (!coupon) {
        throw new AppError(`Invalid coupon code: ${couponCode}`, 400);
    }

    if (coupon.minCartValue && itemsPrice < coupon.minCartValue) {
        throw new AppError(
            `Coupon ${coupon.code} requires a minimum cart value of Rs ${coupon.minCartValue}`,
            400
        );
    }

    if (coupon.paymentMethod && coupon.paymentMethod !== paymentMethod) {
        throw new AppError(`Coupon ${coupon.code} is only valid for ${coupon.paymentMethod} payments`, 400);
    }

    let couponDiscount = 0;
    if (coupon.type === 'percentage') {
        const rawDiscount = (itemsPrice * coupon.value) / 100;
        couponDiscount = coupon.maxDiscount ? Math.min(rawDiscount, coupon.maxDiscount) : rawDiscount;
    } else if (coupon.type === 'flat') {
        couponDiscount = coupon.value;
    } else if (coupon.type === 'free_shipping') {
        couponDiscount = shippingPrice;
    }

    couponDiscount = roundCurrency(Math.max(0, couponDiscount));
    const maxApplicable = roundCurrency(itemsPrice + shippingPrice);
    couponDiscount = Math.min(couponDiscount, maxApplicable);

    return {
        couponDiscount,
        appliedCoupon: {
            code: coupon.code,
            type: coupon.type,
            description: coupon.description,
        },
    };
};

const getPaymentAdjustment = (paymentMethod) => {
    switch (paymentMethod) {
        case 'COD':
            return 25;
        case 'UPI':
            return -20;
        case 'WALLET':
            return -10;
        case 'CARD':
        default:
            return 0;
    }
};

const getDeliveryEstimate = (deliveryOption, deliverySlot) => {
    if (deliverySlot) {
        return `Scheduled for ${deliverySlot.date} (${deliverySlot.window})`;
    }

    if (deliveryOption === 'express') {
        return 'Estimated delivery in 1-2 business days';
    }

    return 'Estimated delivery in 3-5 business days';
};

const calculatePricing = async ({
    resolvedItems,
    deliveryOption,
    paymentMethod,
    couponCode = '',
}) => {
    const itemsPrice = resolvedItems.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
    
    // Solve NP-Hard Logistics optimization
    const logistics = await calculateOptimalLogisticsCost(resolvedItems);
    const baseShipping = logistics.shippingFee;
    
    const deliverySurcharge = deliveryOption === 'express' ? 79 : 0;
    const shippingPrice = roundCurrency(baseShipping + deliverySurcharge);
    const paymentAdjustment = roundCurrency(getPaymentAdjustment(paymentMethod));

    const { couponDiscount, appliedCoupon } = evaluateCoupon({
        couponCode,
        itemsPrice,
        shippingPrice,
        paymentMethod,
    });

    const preTaxTotal = roundCurrency(itemsPrice + shippingPrice + paymentAdjustment - couponDiscount);
    const taxBase = roundCurrency(Math.max(itemsPrice - Math.min(couponDiscount, itemsPrice) + Math.max(paymentAdjustment, 0), 0));
    const taxPrice = roundCurrency(taxBase * 0.18);
    const totalPrice = roundCurrency(Math.max(preTaxTotal, 0) + taxPrice);

    return {
        itemsPrice: roundCurrency(itemsPrice),
        shippingPrice,
        paymentAdjustment,
        couponDiscount,
        taxPrice,
        totalPrice,
        appliedCoupon,
        logisticsInsights: {
            ...logistics.insights,
            consolidationEfficiency: logistics.insights.consolidationEfficiency,
            ecoBadge: logistics.insights.ecoBadge
        },
    };
};

const buildOrderQuote = async (payload, { session = null, checkStock = true } = {}) => {
    const normalized = normalizeCheckoutPayload(payload);
    const { resolvedItems, itemsPrice } = await resolveProductsForItems(normalized.orderItems, { session, checkStock });
    const pricing = await calculatePricing({
        resolvedItems,
        deliveryOption: normalized.deliveryOption,
        paymentMethod: normalized.paymentMethod,
        couponCode: normalized.couponCode,
    });

    // NP-Hard: Delivery Slot Optimization (VRPTW)
    // Simulating regional delivery data for the neighborhood
    const simulatedRegionalDeliveries = [
        { window: '09:00-12:00', lat: 28.62, lng: 77.21 },
        { window: '09:00-12:00', lat: 28.58, lng: 77.18 },
        { window: '15:00-18:00', lat: 28.70, lng: 77.25 }
    ];
    const optimizedSlots = calculateOptimalDeliverySlots(normalized.shippingAddress, simulatedRegionalDeliveries);

    // NP-Hard: Aura-Cover (Set Cover)
    // Simulating seller inventory for fulfillment optimization
    const itemIds = resolvedItems.map(i => i.productId);
    const sellerInventoryMap = {
        'S-HQ': new Set(itemIds), // Aura Central Warehouse (fully covered)
        'S-Local-1': new Set(itemIds.slice(0, Math.ceil(itemIds.length / 2))),
        'S-Local-2': new Set(itemIds.slice(Math.floor(itemIds.length / 2)))
    };
    const optimizedPackages = solveAuraCover(itemIds, sellerInventoryMap);

    const deliveryEstimate = getDeliveryEstimate(normalized.deliveryOption, normalized.deliverySlot);

    return {
        normalized,
        resolvedItems,
        pricing: {
            ...pricing,
            deliveryEstimate,
            optimizedSlots, 
            optimizedPackages, // Injecting Set Cover results
            priceBreakdown: {
                itemsPrice: pricing.itemsPrice,
                shippingPrice: pricing.shippingPrice,
                paymentAdjustment: pricing.paymentAdjustment,
                couponDiscount: pricing.couponDiscount,
                taxPrice: pricing.taxPrice,
                totalPrice: pricing.totalPrice,
                logisticsInsights: pricing.logisticsInsights,
            },
            pricingVersion: PRICING_VERSION,
        },
    };
};

const normalizePaymentSimulation = (simulation = {}) => {
    const status = String(simulation.status || '').toLowerCase();
    const referenceId = String(simulation.referenceId || '').trim();

    return { status, referenceId };
};

const getSimulationBucket = ({ paymentMethod, amount, attemptToken }) => {
    const digest = crypto
        .createHash('sha256')
        .update(`${paymentMethod}|${amount}|${attemptToken}`)
        .digest('hex');

    const numeric = parseInt(digest.slice(0, 8), 16);
    return {
        bucket: numeric % 100,
        digest,
    };
};

const simulatePaymentResult = ({ paymentMethod, amount, attemptToken }) => {
    const normalizedMethod = normalizePaymentMethod(paymentMethod);
    if (normalizedMethod === 'COD') {
        throw new AppError('Payment simulation is only available for digital methods', 400);
    }

    const normalizedAmount = Number(amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        throw new AppError('amount must be a positive number', 400);
    }

    const token = String(attemptToken || '').trim();
    if (!token) {
        throw new AppError('attemptToken is required', 400);
    }

    const { bucket, digest } = getSimulationBucket({
        paymentMethod: normalizedMethod,
        amount: roundCurrency(normalizedAmount),
        attemptToken: token,
    });

    let status = 'success';
    if (bucket >= 65 && bucket < 85) {
        status = 'pending';
    } else if (bucket >= 85) {
        status = 'failure';
    }

    const referenceId = `SIM-${digest.slice(0, 12).toUpperCase()}`;
    const messageMap = {
        success: 'Payment processed successfully',
        pending: 'Payment is pending confirmation',
        failure: 'Payment failed during processing',
    };

    return {
        status,
        referenceId,
        message: messageMap[status],
    };
};

module.exports = {
    PRICING_VERSION,
    SLOT_WINDOWS,
    normalizeCheckoutPayload,
    normalizePaymentSimulation,
    calculatePricing,
    buildOrderQuote,
    simulatePaymentResult,
};
