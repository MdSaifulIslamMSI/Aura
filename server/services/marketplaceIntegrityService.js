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

const MARKETPLACE_SEED_MARKER = 'AURA_SEED_2024';
const MARKETPLACE_SEED_REGEX = new RegExp(MARKETPLACE_SEED_MARKER, 'i');

const MAX_IMAGE_URL_LENGTH = 1200;
const MAX_DATA_IMAGE_BYTES = 2.5 * 1024 * 1024;
const ALLOWED_DATA_IMAGE_MIME = /^image\/(jpeg|png|webp|jpg)$/i;

const DEMO_TEXT_PATTERNS = [
    MARKETPLACE_SEED_REGEX,
    /\b(?:demo|sample|dummy)\s+(?:listing|item|product)\b/i,
    /\btest\s+listing\b/i,
];

const BLOCKED_IMAGE_PATTERNS = [
    /cdn\.dummyjson\.com/i,
    /picsum\.photos/i,
    /via\.placeholder\.com/i,
    /placehold\.co/i,
    /loremflickr\.com/i,
    /placeholder/i,
];

const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const normalizeNumberInRange = (value, min, max) => {
    if (value === '' || value === null || value === undefined) return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    if (numeric < min || numeric > max) return null;
    return numeric;
};
const getDataUriPrefix = (value) => String(value || '').split(',', 1)[0] || '';
const estimateDataUriBytes = (value) => {
    const base64 = String(value || '').split(',', 2)[1] || '';
    return Math.ceil((base64.length * 3) / 4);
};
const isHttpsUrl = (value) => /^https:\/\/[^\s]+$/i.test(value);

const normalizeListingInput = (payload = {}) => ({
    title: normalizeText(payload.title),
    description: normalizeText(payload.description),
    price: Number(payload.price),
    negotiable: payload.negotiable !== false,
    condition: normalizeText(payload.condition),
    category: normalizeText(payload.category),
    images: Array.isArray(payload.images) ? payload.images.map((image) => String(image || '').trim()).filter(Boolean) : [],
    location: {
        city: normalizeText(payload.location?.city),
        state: normalizeText(payload.location?.state),
        pincode: normalizeText(payload.location?.pincode),
        latitude: normalizeNumberInRange(payload.location?.latitude, -90, 90),
        longitude: normalizeNumberInRange(payload.location?.longitude, -180, 180),
        accuracyMeters: normalizeNumberInRange(payload.location?.accuracyMeters, 0, 1_000_000),
        confidence: normalizeNumberInRange(payload.location?.confidence, 0, 100),
        provider: normalizeText(payload.location?.provider).slice(0, 80),
        capturedAt: (() => {
            const value = payload.location?.capturedAt;
            if (!value) return null;
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? null : date;
        })(),
    },
});

const hasBlockedDemoText = ({ title = '', description = '' } = {}) => {
    const combined = `${title} ${description}`;
    return DEMO_TEXT_PATTERNS.some((pattern) => pattern.test(combined));
};

const isDataImage = (value) => /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);

const isRelativeImagePath = (value) => /^\/(uploads|images)\//i.test(value);

const getInvalidImageReason = (image) => {
    if (!image) {
        return 'Empty image value is not allowed.';
    }

    if (image.length > MAX_IMAGE_URL_LENGTH && !isDataImage(image)) {
        return 'Image URL is too long.';
    }

    if (isDataImage(image)) {
        const mime = (getDataUriPrefix(image).match(/^data:([^;]+);base64$/i) || [])[1] || '';
        if (!ALLOWED_DATA_IMAGE_MIME.test(mime)) {
            return 'Only JPG, PNG, or WEBP images are allowed.';
        }
        if (estimateDataUriBytes(image) > MAX_DATA_IMAGE_BYTES) {
            return 'Image is too large. Please upload a smaller photo.';
        }
        return null;
    }

    if (isRelativeImagePath(image)) {
        return null;
    }

    if (isHttpsUrl(image)) {
        return null;
    }

    return 'Image must be a valid HTTPS URL or uploaded image.';
};

const hasBlockedImageSource = (images = []) =>
    images.some((image) => {
        if (!image) return true;
        if (isDataImage(image) || isRelativeImagePath(image)) {
            return false;
        }
        return BLOCKED_IMAGE_PATTERNS.some((pattern) => pattern.test(image));
    });

const getIntegrityIssue = (listingInput) => {
    if (hasBlockedDemoText(listingInput)) {
        return 'Demo or sample listing text is not allowed in marketplace.';
    }

    const invalidImageReason = (listingInput.images || [])
        .map((image) => getInvalidImageReason(image))
        .find(Boolean);
    if (invalidImageReason) {
        return invalidImageReason;
    }

    if (hasBlockedImageSource(listingInput.images)) {
        return 'Demo or placeholder image sources are not allowed. Upload real product photos.';
    }
    return null;
};

const buildRealListingsFilter = (baseFilter = {}) => ({
    $and: [
        baseFilter,
        { source: { $ne: 'seed' } },
        { description: { $not: MARKETPLACE_SEED_REGEX } },
    ],
});

const isRealListingDoc = (listingDoc = {}) => {
    if (!listingDoc) return false;
    if (listingDoc.source === 'seed') return false;
    return !MARKETPLACE_SEED_REGEX.test(String(listingDoc.description || ''));
};

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
    ATTACK_TEMPLATES,
    MARKETPLACE_SEED_MARKER,
    MARKETPLACE_SEED_REGEX,
    normalizeListingInput,
    getIntegrityIssue,
    buildRealListingsFilter,
    isRealListingDoc,
};
