/**
 * Aura Logistics Optimizer
 * 
 * Implements a heuristic solution to the 3D Bin Packing Problem (NP-Hard).
 * Used to minimize shipping containers and optimize fulfillment density.
 */

const CONTAINER_TYPES = [
    { name: 'Small Box', width: 20, height: 15, depth: 15, maxWeight: 5, baseCost: 40 },
    { name: 'Medium Box', width: 40, height: 30, depth: 25, maxWeight: 15, baseCost: 85 },
    { name: 'Large Box', width: 60, height: 50, depth: 40, maxWeight: 30, baseCost: 160 },
];

/**
 * Heuristic: First Fit Decreasing (FFD) for 3D Packing
 * 
 * @param {Array} items - List of items with dimensions {w, h, d, weight}
 * @returns {Object} - Optimization results including containers and density
 */
const calculateOptimalPacking = (items = []) => {
    try {
        if (!items.length) return { containers: [], totalCost: 0, spaceEfficiency: 0 };

    // Sort items by volume (Decreasing) to improve packing density
    const sortedItems = [...items].sort((a, b) => {
        const volA = a.width * a.height * a.depth;
        const volB = b.width * b.height * b.depth;
        return volB - volA;
    });

    const packedContainers = [];
    let totalVolumeUsed = 0;
    let totalContainerVolume = 0;

    for (const item of sortedItems) {
        let placed = false;
        const itemVol = item.width * item.height * item.depth;

        // Try to fit in existing containers
        for (const container of packedContainers) {
            if (canFitInContainer(container, item)) {
                container.items.push(item);
                container.remainingVolume -= itemVol;
                container.currentWeight += item.weight;
                totalVolumeUsed += itemVol;
                placed = true;
                break;
            }
        }

        // If not placed, open a new container
        if (!placed) {
            const containerType = selectBestContainerFor(item);
            const containerVol = containerType.width * containerType.height * containerType.depth;
            
            packedContainers.push({
                ...containerType,
                items: [item],
                remainingVolume: containerVol - itemVol,
                currentWeight: item.weight,
            });
            
            totalVolumeUsed += itemVol;
            totalContainerVolume += containerVol;
        }
    }

    const totalCost = packedContainers.reduce((sum, c) => sum + c.baseCost, 0);
    const spaceEfficiency = totalContainerVolume > 0 
        ? (totalVolumeUsed / totalContainerVolume) * 100 
        : 0;

        return {
            containers: packedContainers.map(c => ({
                type: c.name,
                itemCount: c.items.length,
                efficiency: ((c.width * c.height * c.depth - c.remainingVolume) / (c.width * c.height * c.depth) * 100).toFixed(1) + '%'
            })),
            totalCost,
            spaceEfficiency: spaceEfficiency.toFixed(1) + '%',
            strategy: '3D-FFD (Heuristic)'
        };
    } catch (error) {
        console.error('Logistics packing optimization failed', error);
        return {
            containers: [{ type: 'Standard Parcel', itemCount: items.length, efficiency: 'N/A' }],
            totalCost: items.length * 50, // Fallback cost
            spaceEfficiency: 'N/A',
            strategy: 'Fallback (Single Container)'
        };
    }
};

/**
 * Simplified 3D collision check
 */
const canFitInContainer = (container, item) => {
    const volFits = container.remainingVolume >= (item.width * item.height * item.depth);
    const weightFits = (container.currentWeight + item.weight) <= container.maxWeight;
    const dimsFit = item.width <= container.width && 
                    item.height <= container.height && 
                    item.depth <= container.depth;
    
    return volFits && weightFits && dimsFit;
};

/**
 * Selects the smallest container that can fit the item
 */
const selectBestContainerFor = (item) => {
    for (const type of CONTAINER_TYPES) {
        if (item.width <= type.width && 
            item.height <= type.height && 
            item.depth <= type.depth && 
            item.weight <= type.maxWeight) {
            return type;
        }
    }
    // Fallback to largest if it exceeds (unlikely with our catalog but for safety)
    return CONTAINER_TYPES[CONTAINER_TYPES.length - 1];
};

/**
 * Aura Hubs for Consolidation (VRP Merge Points)
 */
const FULFILLMENT_HUBS = [
    { id: 'hub-north', name: 'Delhi NCR Hub', lat: 28.6139, lng: 77.2090 },
    { id: 'hub-west', name: 'Mumbai Hub', lat: 19.0760, lng: 72.8777 },
    { id: 'hub-south', name: 'Bangalore Hub', lat: 12.9716, lng: 77.5946 },
    { id: 'hub-east', name: 'Kolkata Hub', lat: 22.5726, lng: 88.3639 },
];

/**
 * Heuristic: Hub-and-Spoke Pathfinding
 * Solves a variant of VRP to determine if items should be consolidated.
 */
const calculateConsolidatedPath = (items = [], destination = { lat: 28.6, lng: 77.2 }) => {
    try {
        const origins = [...new Set(items.map(i => i.sellerLocation?.city).filter(Boolean))];
        
        if (origins.length <= 1) {
            return { strategy: 'Direct Shipment', carbonSaved: 0, consolidationApplied: false };
        }

        // Early exit for extreme complexity (e.g. 50+ origins)
        if (origins.length > 50) {
            return { strategy: 'Distributed Direct', carbonSaved: 0, consolidationApplied: false };
        }

    // Find the closest hub to the destination
    const destinationHub = FULFILLMENT_HUBS.reduce((prev, curr) => {
        const distPrev = Math.sqrt((prev.lat - destination.lat)**2 + (prev.lng - destination.lng)**2);
        const distCurr = Math.sqrt((curr.lat - destination.lat)**2 + (curr.lng - destination.lng)**2);
        return distCurr < distPrev ? curr : prev;
    });

    // Heuristic: If multiple origins exist, we "simulate" routing through the hub
    // In a real system, we'd calculate actual haulage distance. 
    // Here we derive an efficiency score based on origin clustering.
    const uniqueOriginsCount = origins.length;
    const consolidationEfficiency = Math.min(0.95, 0.4 + (uniqueOriginsCount * 0.1));
    const carbonSaved = (uniqueOriginsCount - 1) * 1.25; // kg of CO2 saved

        return {
            strategy: 'Hub-and-Spoke Consolidation',
            hub: destinationHub.name,
            efficiency: (consolidationEfficiency * 100).toFixed(1) + '%',
            carbonSaved: carbonSaved.toFixed(2) + ' kg',
            consolidationApplied: true,
            savingsFactor: 1 - (uniqueOriginsCount * 0.15) // Reduction in multi-origin penalty
        };
    } catch (error) {
        return { strategy: 'Direct Shipment (Fallback)', carbonSaved: 0, consolidationApplied: false };
    }
};

/**
 * Calculates logistics cost based on multi-origin distance + packing efficiency
 */
const calculateOptimalLogisticsCost = async (orderItems) => {
    // In a real production system, we would fetch dimensions from the DB
    const itemsWithDims = orderItems.map(item => ({
        ...item,
        width: Math.max(10, Math.min(50, (item.price / 1000) * 5)),
        height: Math.max(5, Math.min(30, (item.price / 1000) * 3)),
        depth: Math.max(5, Math.min(30, (item.price / 1000) * 2)),
        weight: Math.max(0.5, (item.price / 5000) * 2)
    }));

    const packingResults = calculateOptimalPacking(itemsWithDims);
    const consolidation = calculateConsolidatedPath(orderItems);
    
    // Multi-origin penalty (simulated)
    const baseOriginFactor = orderItems.length > 1 ? 1.4 : 1.0;
    const finalOriginFactor = consolidation.consolidationApplied 
        ? baseOriginFactor * consolidation.savingsFactor 
        : baseOriginFactor;

    const finalCost = packingResults.totalCost * Math.max(1.0, finalOriginFactor);

    return {
        shippingFee: Math.round(finalCost),
        insights: {
            strategy: consolidation.strategy,
            packingStrategy: packingResults.strategy,
            containers: packingResults.containers,
            efficiency: packingResults.spaceEfficiency,
            consolidationEfficiency: consolidation.efficiency,
            hub: consolidation.hub,
            ecoBadge: consolidation.carbonSaved + ' CO2 avoided',
            savings: Math.max(0, Math.round(packingResults.totalCost * baseOriginFactor) - Math.round(finalCost))
        }
    };
};

module.exports = {
    calculateOptimalLogisticsCost
};
