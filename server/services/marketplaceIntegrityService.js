/**
 * Aura Marketplace Integrity Service
 * 
 * Implements an NP-Hard Subgraph Isomorphism heuristic to detect 
 * coordinated attack patterns in the marketplace social/transaction graph.
 */

const logger = require('../utils/logger');

// Known Attack Patterns (Target Subgraphs)
const ATTACK_TEMPLATES = {
    CIRC_REFERRAL: {
        name: 'Circular Referral Ring',
        nodes: ['U1', 'U2', 'U3'],
        edges: [['U1', 'U2'], ['U2', 'U3'], ['U3', 'U1']],
        severity: 'critical'
    },
    SYBIL_AGGREGATION: {
        name: 'Sybil Distribution Hub',
        nodes: ['HUB', 'S1', 'S2', 'S3'],
        edges: [['HUB', 'S1'], ['HUB', 'S2'], ['HUB', 'S3']],
        severity: 'high'
    }
};

const MAX_NEIGHBORHOOD_SIZE = 60; // Guard against Complexity Attacks

/**
 * Heuristic for Subgraph Isomorphism
 * Uses a simplified backtracking approach to find if 'template' exists in 'mainGraph'
 */
const findPatternMatch = (mainGraph, template) => {
    const { nodes: tNodes, edges: tEdges } = template;
    const { nodes: gNodes, neighbors: gNeighbors } = mainGraph;

    if (gNodes.length < tNodes.length) return null;

    // Backtracking search for a valid mapping
    const mapping = new Map();
    const usedGNodes = new Set();

    const isCompatible = (tNode, gNode) => {
        // Basic degree check (heuristic)
        const tDegree = tEdges.filter(e => e.includes(tNode)).length;
        const gDegree = (gNeighbors.get(gNode) || new Set()).size;
        return gDegree >= tDegree;
    };

    const solve = (tIdx) => {
        if (tIdx === tNodes.length) return true;

        const tNode = tNodes[tIdx];
        for (const gNode of gNodes) {
            if (usedGNodes.has(gNode)) continue;
            if (!isCompatible(tNode, gNode)) continue;

            // Check if all existing edges in template are preserved in mainGraph mapping
            let edgesValid = true;
            for (let i = 0; i < tIdx; i++) {
                const prevTNode = tNodes[i];
                const prevGNode = mapping.get(prevTNode);

                const hasTEdge = tEdges.some(e => e.includes(tNode) && e.includes(prevTNode));
                if (hasTEdge) {
                    const hasGEdge = gNeighbors.get(gNode)?.has(prevGNode);
                    if (!hasGEdge) {
                        edgesValid = false;
                        break;
                    }
                }
            }

            if (edgesValid) {
                mapping.set(tNode, gNode);
                usedGNodes.add(gNode);
                if (solve(tIdx + 1)) return true;
                usedGNodes.delete(gNode);
                mapping.delete(tNode);
            }
        }
        return false;
    };

    if (solve(0)) {
        return Object.fromEntries(mapping);
    }
    return null;
};

/**
 * Sweeps a specific neighborhood for fraud patterns
 */
const scanForMarketplaceAnomalies = async (seedUserId, neighborhoodData = []) => {
    const startTime = Date.now();
    
    // Build main graph from neighborhoodData (edges: [from, to])
    const limitedData = neighborhoodData.slice(0, MAX_NEIGHBORHOOD_SIZE);
    const nodes = [...new Set(limitedData.flat())];
    const neighbors = new Map();
    nodes.forEach(n => neighbors.set(n, new Set()));
    neighborhoodData.forEach(([from, to]) => {
        neighbors.get(from).add(to);
        neighbors.get(to).add(from); // Undirected for high-level connectivity
    });

    const graph = { nodes, neighbors };
    const findings = [];

    for (const [key, template] of Object.entries(ATTACK_TEMPLATES)) {
        const match = findPatternMatch(graph, template);
        if (match) {
            findings.push({
                pattern: template.name,
                severity: template.severity,
                involvedUsers: Object.values(match)
            });
        }
    }

    const duration = Date.now() - startTime;
    if (findings.length > 0) {
        logger.warn('integrity.anomaly_detected', { 
            findings, 
            durationMs: duration,
            nodeCount: nodes.length 
        });
    }

    return {
        anomalyCount: findings.length,
        findings,
        analysisTime: duration + 'ms',
        protectionLevel: 'Graph-Isomorphism Active'
    };
};

module.exports = {
    scanForMarketplaceAnomalies,
    ATTACK_TEMPLATES
};
