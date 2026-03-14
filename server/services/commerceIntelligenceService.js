const Product = require('../models/Product');
const Decimal = require('decimal.js');
const { flags: catalogFlags } = require('../config/catalogFlags');
const { getActiveCatalogVersion } = require('./catalogService');

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
const safeText = (value) => String(value || '').toLowerCase();

const buildActiveCatalogFilter = async () => {
    if (!catalogFlags.catalogActiveVersionRequired) return {};
    const activeCatalogVersion = await getActiveCatalogVersion();
    return {
        isPublished: true,
        catalogVersion: activeCatalogVersion,
    };
};

const computeReturnRisk = (product = {}) => {
    const rating = Number(product.rating) || 0;
    const reviewCount = Number(product.ratingCount) || 0;
    const stock = Number(product.stock) || 0;
    const hasWarranty = Boolean(String(product.warranty || '').trim());
    const discount = Number(product.discountPercentage) || 0;

    let riskScore = 10;
    const reasons = [];

    if (rating < 3.3) {
        riskScore += 28;
        reasons.push('Low user rating signal');
    } else if (rating < 4) {
        riskScore += 14;
        reasons.push('Mixed rating signal');
    }

    if (reviewCount < 50) {
        riskScore += 22;
        reasons.push('Low review confidence');
    } else if (reviewCount < 200) {
        riskScore += 10;
        reasons.push('Moderate review confidence');
    }

    if (stock <= 0) {
        riskScore += 22;
        reasons.push('Out of stock risk');
    } else if (stock < 5) {
        riskScore += 12;
        reasons.push('Low stock instability');
    }

    if (!hasWarranty) {
        riskScore += 15;
        reasons.push('No warranty coverage');
    }

    if (discount > 70) {
        riskScore += 10;
        reasons.push('Extreme discount anomaly');
    }

    const score = clamp(riskScore, 0, 100);
    const tier = score >= 65 ? 'high' : (score >= 38 ? 'medium' : 'low');

    return {
        score,
        tier,
        reasons,
    };
};

const computeDealDna = (product = {}) => {
    const price = Number(product.price) || 0;
    const originalPrice = Number(product.originalPrice || product.price) || 0;
    const rating = clamp(product.rating, 0, 5);
    const reviewCount = Number(product.ratingCount) || 0;
    const stock = Number(product.stock) || 0;
    const hasWarranty = Boolean(String(product.warranty || '').trim());
    const returnRisk = computeReturnRisk(product);

    const savingsRatio = originalPrice > 0 ? clamp((originalPrice - price) / originalPrice, 0, 0.95) : 0;
    const priceScore = clamp(savingsRatio * 100, 0, 100);
    const ratingScore = clamp((rating / 5) * 100, 0, 100);
    const reviewConfidence = clamp(Math.log10(Math.max(1, reviewCount + 1)) * 28, 0, 100);
    const stockHealth = stock <= 0 ? 0 : (stock < 5 ? 45 : (stock < 20 ? 72 : 90));
    const warrantyBoost = hasWarranty ? 88 : 35;
    const riskPenalty = returnRisk.score;

    const weightedScore = Decimal.sum(
        new Decimal(priceScore).times(0.28),
        new Decimal(ratingScore).times(0.24),
        new Decimal(reviewConfidence).times(0.14),
        new Decimal(stockHealth).times(0.14),
        new Decimal(warrantyBoost).times(0.08),
        new Decimal(100 - riskPenalty).times(0.12)
    ).toNumber();

    const score = clamp(Math.round(weightedScore), 0, 100);
    let verdict = 'wait';
    if (score >= 70) verdict = 'good_deal';
    if (score < 45) verdict = 'avoid';

    return {
        score,
        verdict,
        components: {
            priceScore: Math.round(priceScore),
            ratingScore: Math.round(ratingScore),
            reviewConfidence: Math.round(reviewConfidence),
            stockHealth,
            warrantyBoost,
            returnRisk: returnRisk.score,
        },
        returnRisk,
        message: verdict === 'good_deal'
            ? 'Strong value right now'
            : verdict === 'avoid'
                ? 'Risk outweighs deal quality'
                : 'Reasonable but monitor for better timing',
    };
};

const detectDeviceProfile = (product = {}) => {
    const text = safeText(`${product.title} ${product.category} ${product.description || ''}`);

    const profile = {
        type: 'generic',
        ecosystem: text.includes('apple') || safeText(product.brand).includes('apple')
            ? 'apple'
            : (text.includes('android') ? 'android' : 'generic'),
        connectors: [],
        keywords: [],
    };

    if (/phone|iphone|mobile|smartphone/.test(text)) profile.type = 'phone';
    else if (/laptop|notebook|macbook|ultrabook/.test(text)) profile.type = 'laptop';
    else if (/watch|smartwatch|wearable/.test(text)) profile.type = 'watch';
    else if (/tablet|ipad/.test(text)) profile.type = 'tablet';
    else if (/camera|dslr/.test(text)) profile.type = 'camera';
    else if (/console|playstation|xbox|gaming/.test(text)) profile.type = 'gaming';

    if (/usb[-\s]?c|type[-\s]?c|thunderbolt/.test(text)) profile.connectors.push('usb-c');
    if (/lightning/.test(text)) profile.connectors.push('lightning');
    if (/magsafe/.test(text)) profile.connectors.push('magsafe');
    if (/thunderbolt/.test(text)) profile.connectors.push('thunderbolt');

    const profileKeywords = {
        phone: ['charger', 'cable', 'case', 'power bank', 'earbuds', 'screen guard'],
        laptop: ['dock', 'usb hub', 'sleeve', 'mouse', 'keyboard', 'charger'],
        watch: ['watch strap', 'watch charger', 'band'],
        tablet: ['tablet cover', 'stylus', 'charger', 'keyboard'],
        camera: ['tripod', 'sd card', 'camera bag', 'battery'],
        gaming: ['controller', 'headset', 'cooling pad', 'charging dock'],
        generic: ['accessory', 'cable', 'charger'],
    };
    profile.keywords = profileKeywords[profile.type] || profileKeywords.generic;
    return profile;
};

const buildCompatibilityScore = ({ baseProduct, accessory, profile }) => {
    let score = 28;
    const reasons = [];
    const baseBrand = safeText(baseProduct.brand);
    const accessoryText = safeText(`${accessory.title} ${accessory.category} ${accessory.description || ''}`);

    if (baseBrand && accessoryText.includes(baseBrand)) {
        score += 24;
        reasons.push('Brand ecosystem match');
    }

    profile.connectors.forEach((connector) => {
        if (accessoryText.includes(connector)) {
            score += 14;
            reasons.push(`Connector support: ${connector}`);
        }
    });

    if (profile.type !== 'generic' && accessoryText.includes(profile.type)) {
        score += 12;
        reasons.push(`Designed for ${profile.type}`);
    }

    const rating = clamp(accessory.rating, 0, 5);
    score += Math.round((rating / 5) * 20);
    if (rating >= 4.2) reasons.push('High rating confidence');

    if ((Number(accessory.stock) || 0) > 0) score += 6;
    return {
        score: clamp(Math.round(score), 0, 99),
        reasons: reasons.slice(0, 3),
    };
};

const getCompatibilityGraph = async (product, options = {}) => {
    const limitPerType = Math.min(Math.max(Number(options.limitPerType) || 3, 1), 8);
    const profile = detectDeviceProfile(product);
    const activeFilter = await buildActiveCatalogFilter();

    const groups = [];
    const usedIds = new Set();

    for (const keyword of profile.keywords.slice(0, 6)) {
        const regex = new RegExp(keyword.replace(/\s+/g, '.*'), 'i');
        const docs = await Product.find({
            ...activeFilter,
            id: { $ne: product.id },
            $or: [
                { title: regex },
                { category: regex },
                { description: regex },
            ],
        })
            .sort({ rating: -1, ratingCount: -1, stock: -1 })
            .limit(20)
            .lean();

        const scored = docs
            .filter((item) => !usedIds.has(String(item._id)))
            .map((item) => {
                const compatibility = buildCompatibilityScore({
                    baseProduct: product,
                    accessory: item,
                    profile,
                });
                return { ...item, compatibility };
            })
            .sort((a, b) => b.compatibility.score - a.compatibility.score)
            .slice(0, limitPerType);

        if (scored.length === 0) continue;
        scored.forEach((item) => usedIds.add(String(item._id)));

        groups.push({
            accessoryType: keyword,
            matches: scored.map((item) => ({
                id: item.id,
                _id: item._id,
                title: item.title,
                brand: item.brand,
                category: item.category,
                image: item.image,
                price: item.price,
                rating: item.rating,
                compatibilityScore: item.compatibility.score,
                reasons: item.compatibility.reasons,
            })),
        });
    }

    return {
        baseProduct: {
            id: product.id,
            title: product.title,
            type: profile.type,
            ecosystem: profile.ecosystem,
            connectors: profile.connectors,
        },
        groups,
        totalMatches: groups.reduce((sum, group) => sum + group.matches.length, 0),
    };
};

const resolveBundleProfile = (theme = '') => {
    const input = safeText(theme);
    if (/(home\s*gym|fitness|workout|strength|exercise)/.test(input)) {
        return {
            name: 'Home Gym Starter Kit',
            categories: ['sports', 'electronics'],
            keywords: ['dumbbell', 'resistance', 'yoga', 'fitness watch', 'protein shaker', 'treadmill'],
        };
    }
    if (/(creator|content|studio|youtube|stream)/.test(input)) {
        return {
            name: 'Creator Studio Stack',
            categories: ['electronics', 'laptops', 'gaming'],
            keywords: ['camera', 'microphone', 'tripod', 'laptop', 'ring light', 'ssd'],
        };
    }
    if (/(gaming|esports|streamer)/.test(input)) {
        return {
            name: 'Gaming Command Kit',
            categories: ['gaming', 'electronics', 'laptops'],
            keywords: ['gaming', 'headset', 'mouse', 'keyboard', 'controller', 'monitor'],
        };
    }
    return {
        name: `${theme || 'Smart'} Essentials Bundle`,
        categories: ['electronics', 'home-kitchen', 'mobiles', 'laptops'],
        keywords: [theme || 'smart', 'accessory', 'charger', 'kit'],
    };
};

const buildSmartBundle = async ({ theme, budget, maxItems = 6 }) => {
    const W = Math.max(1000, Math.min(Number(budget) || 25000, 500000));
    const N_LIMIT = Math.max(2, Math.min(Number(maxItems) || 6, 12));
    const profile = resolveBundleProfile(theme);
    const activeFilter = await buildActiveCatalogFilter();

    const keywordRegex = profile.keywords
        .filter(Boolean)
        .slice(0, 8)
        .map((keyword) => new RegExp(keyword.replace(/\s+/g, '.*'), 'i'));

    // 1. Candidate Selection (Heuristic pruning before expensive DP)
    const candidates = await Product.find({
        ...activeFilter,
        price: { $gt: 0, $lte: W },
        $or: [
            ...(profile.categories.length > 0 ? [{ category: { $in: profile.categories.map((entry) => new RegExp(`^${entry.replace('-', '[-\\s]?')}$`, 'i')) } }] : []),
            ...keywordRegex.map((regex) => ({ title: regex })),
            ...keywordRegex.map((regex) => ({ description: regex })),
        ],
    })
        .sort({ rating: -1, discountPercentage: -1, ratingCount: -1 })
        .limit(60) // Limit n for DP performance
        .lean();

    if (candidates.length === 0) {
        return { bundleName: profile.name, items: [], totalPrice: 0, budget: W };
    }

    // 2. 0/1 Knapsack DP Implementation
    // We want to maximize "Value" defined by: (Rating * ReviewConfidence + Discount)
    // Scale prices to integers for DP table indexing
    
    let selected = [];
    let totalPrice = 0;
    let originalTotal = 0;

    try {
        const n = candidates.length;
        const items = candidates.map(c => ({
            ...c,
            weight: Math.round(Number(c.price)),
            value: Math.round((Number(c.rating || 0) * Math.log10(Number(c.ratingCount || 0) + 1) * 10) + Number(c.discountPercentage || 0))
        }));

        const dp = new Array(W + 1).fill(0);
        const keep = Array.from({ length: n + 1 }, () => new Uint8Array(W + 1));

        for (let i = 1; i <= n; i++) {
            const { weight, value } = items[i - 1];
            for (let w = W; w >= weight; w--) {
                if (dp[w - weight] + value > dp[w]) {
                    dp[w] = dp[w - weight] + value;
                    keep[i][w] = 1; 
                }
            }
        }

        let currentW = W;
        for (let i = n; i > 0 && currentW > 0; i--) {
            if (keep[i][currentW]) {
                const item = items[i - 1];
                selected.push({
                    id: item.id,
                    _id: item._id,
                    title: item.title,
                    brand: item.brand,
                    category: item.category,
                    image: item.image,
                    price: item.weight,
                    originalPrice: Number(item.originalPrice || item.price) || item.weight,
                    quantity: 1,
                    rating: Number(item.rating) || 0,
                    ratingCount: Number(item.ratingCount) || 0,
                    deliveryTime: item.deliveryTime || '3-5 days',
                });
                currentW -= item.weight;
            }
            if (selected.length >= N_LIMIT) break;
        }
        totalPrice = selected.reduce((sum, item) => sum + item.price, 0);
        originalTotal = selected.reduce((sum, item) => sum + (Number(item.originalPrice) || item.price), 0);
    } catch (error) {
        // Fallback: Just pick top rated items within budget if DP fails or exceeds memory
        const sorted = [...candidates].sort((a, b) => b.rating - a.rating);
        let currentBudget = W;
        for (const item of sorted) {
            if (selected.length >= N_LIMIT) break;
            const price = Math.round(Number(item.price));
            if (price <= currentBudget) {
                selected.push({
                    id: item.id,
                    _id: item._id,
                    title: item.title,
                    brand: item.brand,
                    category: item.category,
                    image: item.image,
                    price,
                    originalPrice: Number(item.originalPrice || item.price) || price,
                    quantity: 1,
                    rating: Number(item.rating) || 0,
                    ratingCount: Number(item.ratingCount) || 0,
                    deliveryTime: item.deliveryTime || '3-5 days',
                });
                currentBudget -= price;
            }
        }
        totalPrice = selected.reduce((sum, item) => sum + item.price, 0);
        originalTotal = selected.reduce((sum, item) => sum + (Number(item.originalPrice) || item.price), 0);
    }

    const totalPriceVal = selected.reduce((sum, item) => sum + item.price, 0);
    const originalTotalVal = selected.reduce((sum, item) => sum + (Number(item.originalPrice) || item.price), 0);
    const savings = Math.max(0, originalTotalVal - totalPriceVal);
    const budgetUtilization = W > 0 ? ((totalPriceVal / W) * 100) : 0;

    return {
        bundleName: profile.name,
        theme,
        budget: W,
        maxItems: N_LIMIT,
        totalPrice: Math.round(totalPriceVal),
        originalTotal: Math.round(originalTotalVal),
        savings: Math.round(savings),
        budgetUtilization: Number(budgetUtilization.toFixed(1)),
        items: selected,
        solver: 'dp_01_knapsack_v1',
        checkoutPayload: {
            items: selected.map((item) => ({ id: item.id, quantity: 1 })),
            estimatedTotal: Math.round(totalPriceVal),
        },
    };
};

module.exports = {
    computeReturnRisk,
    computeDealDna,
    getCompatibilityGraph,
    buildSmartBundle,
};
