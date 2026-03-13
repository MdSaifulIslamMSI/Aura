/**
 * Aura GPS Trinity: NP-Hard Geospatial Heuristics
 * 
 * 1. Aura-Hub (Greedy Facility Location)
 * 2. Aura-Cluster (K-Median Clustering for demand centroids)
 * 3. Aura-Zone (Balanced Districting/Partitioning)
 */

/**
 * Heuristic for Facility Location (Hub Placement)
 * Minimizes the sum of distances from demand points to the nearest hub.
 */
exports.solveAuraHub = (demandPoints, candidateHubs, maxHubs = 3) => {
    // demandPoints: Array of { lat, lng, weight }
    // candidateHubs: Array of { id, lat, lng }
    
    let selectedHubs = [];
    let remainingCandidates = [...candidateHubs];
    
    while (selectedHubs.length < maxHubs && remainingCandidates.length > 0) {
        let bestCandidate = null;
        let bestImprovement = -Infinity;
        
        for (let i = 0; i < remainingCandidates.length; i++) {
            const candidate = remainingCandidates[i];
            const currentTotalDist = calculateTotalDistance(demandPoints, selectedHubs);
            const newTotalDist = calculateTotalDistance(demandPoints, [...selectedHubs, candidate]);
            const improvement = currentTotalDist - newTotalDist;
            
            if (improvement > bestImprovement) {
                bestImprovement = improvement;
                bestCandidate = { candidate, index: i };
            }
        }
        
        if (bestCandidate && bestImprovement > 0) {
            selectedHubs.push(bestCandidate.candidate);
            remainingCandidates.splice(bestCandidate.index, 1);
        } else {
            break;
        }
    }
    
    return selectedHubs;
};

/**
 * Heuristic for K-Median Clustering (Demand Centroids)
 * Identifies 'K' points that minimize distance to all assigned demand points.
 */
exports.solveAuraCluster = (points, k = 3) => {
    if (points.length <= k) return points.map(p => ({ ...p, isCentroid: true }));
    
    // Initial seeds (Random selection from points)
    let centroids = points.slice(0, k).map(p => ({ lat: p.lat, lng: p.lng }));
    
    // Simple 2-iteration refinement (Heuristic vs full Lloyd's)
    for (let iter = 0; iter < 2; iter++) {
        const clusters = Array.from({ length: k }, () => []);
        
        // Assign points to nearest centroid
        points.forEach(p => {
            let minDist = Infinity;
            let bestIndex = 0;
            centroids.forEach((c, idx) => {
                const d = Math.sqrt((p.lat - c.lat)**2 + (p.lng - c.lng)**2);
                if (d < minDist) {
                    minDist = d;
                    bestIndex = idx;
                }
            });
            clusters[bestIndex].push(p);
        });
        
        // Update centroids to mean of clusters
        centroids = clusters.map((cluster, idx) => {
            if (cluster.length === 0) return centroids[idx];
            const avgLat = cluster.reduce((sum, p) => sum + p.lat, 0) / cluster.length;
            const avgLng = cluster.reduce((sum, p) => sum + p.lng, 0) / cluster.length;
            return { lat: avgLat, lng: avgLng };
        });
    }
    
    return centroids.map((c, i) => ({
        id: `centroid-${i}`,
        lat: Number(c.lat.toFixed(6)),
        lng: Number(c.lng.toFixed(6)),
        weight: points.length // Simulated volume
    }));
};

/**
 * Heuristic for Balanced Districting (Zone Partitioning)
 * Partitions a space into zones with balanced 'load'.
 */
exports.solveAuraZone = (deliveries, zoneCount = 4) => {
    // Sort deliveries by longitude to create vertical strips (Simple partitioning heuristic)
    const sorted = [...deliveries].sort((a, b) => a.lng - b.lng);
    const zones = [];
    const size = Math.ceil(sorted.length / zoneCount);
    
    for (let i = 0; i < zoneCount; i++) {
        const zoneDeliveries = sorted.slice(i * size, (i + 1) * size);
        if (zoneDeliveries.length > 0) {
            zones.push({
                id: `zone-${i}`,
                deliveryCount: zoneDeliveries.length,
                bounds: {
                    minLat: Math.min(...zoneDeliveries.map(d => d.lat)),
                    maxLat: Math.max(...zoneDeliveries.map(d => d.lat)),
                    minLng: Math.min(...zoneDeliveries.map(d => d.lng)),
                    maxLng: Math.max(...zoneDeliveries.map(d => d.lng)),
                }
            });
        }
    }
    
    return zones;
};

// Helper to calculate aggregate Euclidean distance (Simulated GPS distance)
function calculateTotalDistance(points, hubs) {
    if (hubs.length === 0) return 1000000; // Large penalty for no hubs
    return points.reduce((sum, p) => {
        let minDist = Infinity;
        hubs.forEach(h => {
            const d = Math.sqrt((p.lat - h.lat)**2 + (p.lng - h.lng)**2);
            if (d < minDist) minDist = d;
        });
        return sum + (minDist * (p.weight || 1));
    }, 0);
}
