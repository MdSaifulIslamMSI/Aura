/**
 * Aura Marketplace Trinity: NP-Hard Heuristics
 * 
 * 1. Aura-Cover (Greedy Set Cover for fulfillment)
 * 2. Aura-Bundle (Greedy Knapsack for value-based bundling)
 * 3. Aura-Match (Gale-Shapley variant for seller-buyer matching)
 */

/**
 * Heuristic for Set Cover (Minimum Sellers for Cart)
 * Minimizes the number of 'packages' by selecting sellers that cover the most items.
 */
exports.solveAuraCover = (cartItems, sellerInventoryMap) => {
    // cartItems: Array of product IDs needed
    // sellerInventoryMap: Map<SellerId, Set<ProductId>>
    
    let uncovered = new Set(cartItems);
    const selectedSellers = [];
    
    while (uncovered.size > 0) {
        let bestSeller = null;
        let bestCoveredCount = 0;
        
        for (const [sellerId, inventory] of Object.entries(sellerInventoryMap)) {
            const intersection = [...inventory].filter(id => uncovered.has(id));
            if (intersection.length > bestCoveredCount) {
                bestCoveredCount = intersection.length;
                bestSeller = { id: sellerId, items: intersection };
            }
        }
        
        if (!bestSeller) break; // Should not happen if inventory covers items
        
        selectedSellers.push(bestSeller);
        bestSeller.items.forEach(id => uncovered.delete(id));
    }
    
    return selectedSellers;
};

/**
 * Heuristic for Knapsack (Value-optimized bundling)
 * Selects items to maximize 'utility' within a weight/budget constraint.
 */
exports.solveAuraBundle = (candidates, maxBudget) => {
    // candidates: Array of { id, price, utilityScore }
    // Greedy approach: sort by density (utility/price)
    const sorted = [...candidates].sort((a, b) => (b.utilityScore / b.price) - (a.utilityScore / a.price));
    
    let currentBudget = 0;
    const bundle = [];
    
    for (const item of sorted) {
        if (currentBudget + item.price <= maxBudget) {
            bundle.push(item);
            currentBudget += item.price;
        }
    }
    
    return { bundle, totalSpent: currentBudget, unusedBudget: maxBudget - currentBudget };
};

/**
 * Heuristic for Stable Matching (Seller-Buyer Match)
 * A variant of Gale-Shapley where we rank sellers for a specific buyer intent.
 */
exports.solveAuraMatch = (buyerPreferences, listings) => {
    // buyerPreferences: { categoryWeights: Map, maxPrice, minTrust }
    // listings: Array of Listing docs with .seller populated
    
    return listings.map(listing => {
        const weight = buyerPreferences.categoryWeights?.[listing.category] || 1;
        const priceAffinity = 1 - Math.min(1, Math.abs(listing.price - buyerPreferences.maxPrice) / buyerPreferences.maxPrice);
        const trustScore = (listing.seller?.reputationScore || 50) / 100;
        
        const matchScore = (weight * 0.4) + (priceAffinity * 0.3) + (trustScore * 0.3);
        
        return {
            ...listing,
            matchScore: Math.round(matchScore * 100)
        };
    }).sort((a, b) => b.matchScore - a.matchScore);
};
