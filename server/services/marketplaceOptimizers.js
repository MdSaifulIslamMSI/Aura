/**
 * Marketplace Optimization Heuristics
 * 
 * 1. Set Cover (Greedy minimum-seller fulfillment)
 * 2. Knapsack (Greedy value-based bundling)
 * 3. Stable Matching (Weighted seller-buyer ranking)
 */

/**
 * Heuristic for Set Cover (Minimum Sellers for Cart)
 * Minimizes the number of 'packages' by selecting sellers that cover the most items with sufficient stock.
 */
exports.solveAuraCover = (cartItems, sellerInventoryMap) => {
    // cartItems: Array of { id, quantity }
    // sellerInventoryMap: Map<SellerId, Map<ProductId, StockCount>>
    
    // Map of productId -> remaining quantity needed
    const uncovered = new Map();
    cartItems.forEach(item => {
        uncovered.set(item.id, (uncovered.get(item.id) || 0) + (item.quantity || 1));
    });

    const selectedSellers = [];
    
    while (uncovered.size > 0) {
        let bestSeller = null;
        let bestCoveredScore = 0;
        
        for (const [sellerId, inventory] of Object.entries(sellerInventoryMap)) {
            let sellerScore = 0;
            const coveredItems = [];
            
            for (const [productId, neededQty] of uncovered.entries()) {
                const stock = inventory instanceof Map ? inventory.get(productId) : (inventory[productId] || 0);
                if (stock > 0) {
                    const coveredQty = Math.min(stock, neededQty);
                    sellerScore += coveredQty;
                    coveredItems.push({ id: productId, quantity: coveredQty });
                }
            }
            
            if (sellerScore > bestCoveredScore) {
                bestCoveredScore = sellerScore;
                bestSeller = { id: sellerId, items: coveredItems };
            }
        }
        
        if (!bestSeller || bestCoveredScore === 0) break;
        
        selectedSellers.push(bestSeller);
        bestSeller.items.forEach(item => {
            const currentNeeded = uncovered.get(item.id);
            if (currentNeeded <= item.quantity) {
                uncovered.delete(item.id);
            } else {
                uncovered.set(item.id, currentNeeded - item.quantity);
            }
        });
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

/**
 * Lightweight weighted clustering for marketplace hotspot summaries.
 * Groups nearby points into k centroids without requiring any external geo engine.
 */
exports.solveAuraCluster = (points = [], clusterCount = 3) => {
    const normalizedPoints = Array.isArray(points)
        ? points
            .map((point) => ({
                lat: Number(point?.lat),
                lng: Number(point?.lng),
                weight: Math.max(1, Number(point?.weight) || 0),
            }))
            .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
        : [];

    if (normalizedPoints.length === 0) {
        return [];
    }

    const targetClusterCount = Math.max(1, Math.min(Number(clusterCount) || 1, normalizedPoints.length));
    const seeds = [...normalizedPoints]
        .sort((left, right) => right.weight - left.weight)
        .slice(0, targetClusterCount)
        .map((point) => ({ ...point }));

    const clusters = seeds.map((seed) => ({
        lat: seed.lat,
        lng: seed.lng,
        totalWeight: 0,
        memberCount: 0,
        weightedLat: 0,
        weightedLng: 0,
        peakWeight: 0,
    }));

    const getDistance = (left, right) => Math.hypot(left.lat - right.lat, left.lng - right.lng);

    normalizedPoints.forEach((point) => {
        let bestClusterIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;

        clusters.forEach((cluster, index) => {
            const distance = getDistance(point, cluster);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestClusterIndex = index;
            }
        });

        const cluster = clusters[bestClusterIndex];
        cluster.totalWeight += point.weight;
        cluster.memberCount += 1;
        cluster.weightedLat += point.lat * point.weight;
        cluster.weightedLng += point.lng * point.weight;
        cluster.peakWeight = Math.max(cluster.peakWeight, point.weight);
    });

    return clusters
        .filter((cluster) => cluster.memberCount > 0 && cluster.totalWeight > 0)
        .map((cluster) => ({
            lat: Number((cluster.weightedLat / cluster.totalWeight).toFixed(2)),
            lng: Number((cluster.weightedLng / cluster.totalWeight).toFixed(2)),
            strength: Math.min(100, Math.round(cluster.totalWeight / cluster.memberCount)),
            memberCount: cluster.memberCount,
            peakWeight: cluster.peakWeight,
        }))
        .sort((left, right) => right.strength - left.strength);
};
