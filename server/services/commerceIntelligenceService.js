const Product = require('../models/Product');
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

    const weightedScore = (
        (priceScore * 0.28)
        + (ratingScore * 0.24)
        + (reviewConfidence * 0.14)
        + (stockHealth * 0.14)
        + (warrantyBoost * 0.08)
        + ((100 - riskPenalty) * 0.12)
    );

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
    const safeBudget = Math.max(1000, Math.min(Number(budget) || 25000, 500000));
    const safeMaxItems = Math.max(2, Math.min(Number(maxItems) || 6, 12));
    const profile = resolveBundleProfile(theme);
    const activeFilter = await buildActiveCatalogFilter();

    const keywordRegex = profile.keywords
        .filter(Boolean)
        .slice(0, 8)
        .map((keyword) => new RegExp(keyword.replace(/\s+/g, '.*'), 'i'));

    const candidates = await Product.find({
        ...activeFilter,
        price: { $lte: safeBudget },
        $or: [
            ...(profile.categories.length > 0 ? [{ category: { $in: profile.categories.map((entry) => new RegExp(`^${entry.replace('-', '[-\\s]?')}$`, 'i')) } }] : []),
            ...keywordRegex.map((regex) => ({ title: regex })),
            ...keywordRegex.map((regex) => ({ description: regex })),
        ],
    })
        .sort({ rating: -1, discountPercentage: -1, ratingCount: -1 })
        .limit(120)
        .lean();

    const selected = [];
    const usedCategories = new Set();
    let runningTotal = 0;

    for (const candidate of candidates) {
        if (selected.length >= safeMaxItems) break;
        const price = Number(candidate.price) || 0;
        if (price <= 0 || runningTotal + price > safeBudget) continue;

        const categoryKey = safeText(candidate.category);
        if (usedCategories.has(categoryKey) && selected.length >= Math.ceil(safeMaxItems / 2)) continue;

        selected.push({
            id: candidate.id,
            _id: candidate._id,
            title: candidate.title,
            brand: candidate.brand,
            category: candidate.category,
            image: candidate.image,
            price,
            originalPrice: Number(candidate.originalPrice || candidate.price) || price,
            quantity: 1,
            rating: Number(candidate.rating) || 0,
            ratingCount: Number(candidate.ratingCount) || 0,
            deliveryTime: candidate.deliveryTime || '3-5 days',
        });
        runningTotal += price;
        usedCategories.add(categoryKey);
    }

    const totalPrice = selected.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    const originalTotal = selected.reduce((sum, item) => sum + (Number(item.originalPrice) || Number(item.price) || 0), 0);
    const savings = Math.max(0, originalTotal - totalPrice);
    const budgetUtilization = safeBudget > 0 ? clamp((totalPrice / safeBudget) * 100, 0, 100) : 0;

    return {
        bundleName: profile.name,
        theme,
        budget: safeBudget,
        maxItems: safeMaxItems,
        totalPrice: Math.round(totalPrice),
        originalTotal: Math.round(originalTotal),
        savings: Math.round(savings),
        budgetUtilization: Math.round(budgetUtilization),
        items: selected,
        checkoutPayload: {
            items: selected.map((item) => ({ id: item.id, quantity: 1 })),
            estimatedTotal: Math.round(totalPrice),
        },
    };
};

module.exports = {
    computeReturnRisk,
    computeDealDna,
    getCompatibilityGraph,
    buildSmartBundle,
};
