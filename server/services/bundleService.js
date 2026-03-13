const { solveAuraBundle } = require('./marketplaceOptimizers');
const Product = require('../models/Product');

/**
 * Aura Bundle Service
 * Generates dynamic, value-optimized bundles within a budget.
 */
exports.generateSmartBundle = async (theme, budget) => {
    // 1. Fetch candidates from the catalog based on theme
    const candidates = await Product.find({
        $or: [
            { category: new RegExp(theme, 'i') },
            { title: new RegExp(theme, 'i') },
            { tags: new RegExp(theme, 'i') }
        ],
        isPublished: true,
        stock: { $gt: 0 }
    }).limit(50).lean();

    if (candidates.length === 0) {
        return { bundle: [], totalSpent: 0, strategy: 'Empty Candidate Set' };
    }

    // 2. Assign utility score (Rating * Volume / Price)
    const candidatesWithUtility = candidates.map(p => ({
        id: p.id,
        title: p.title,
        price: p.price,
        image: p.image,
        utilityScore: (p.rating || 4) * (100 - (p.discountPercentage || 0))
    }));

    // 3. Solve NP-Hard Knapsack (Aura-Bundle)
    const { bundle, totalSpent, unusedBudget } = solveAuraBundle(candidatesWithUtility, budget);

    return {
        theme,
        requestedBudget: budget,
        bundle,
        totalSpent,
        unusedBudget,
        efficiencyScore: Math.round((totalSpent / budget) * 100),
        strategy: 'Aura-Bundle (Heuristic Knapsack)'
    };
};
