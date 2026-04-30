/**
 * Aura Dynamic Payment Route Optimizer
 * 
 * Implements a heuristic solution for a Multi-Commodity Flow problem
 * to dynamically route transactions across multiple payment gateways.
 * 
 * Primary Objectives:
 * 1. Maximize Transaction Success Rate (Auth Rate)
 * 2. Minimize Processing Fees
 * 3. Optimize for BIN-Gateway Affinity
 */

const logger = require('../../utils/logger');
const crypto = require('crypto');

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const GATEWAYS = {
    razorpay: {
        id: 'razorpay',
        baseUrl: 'https://api.razorpay.com/v1',
        baseFee: 0.02, // 2%
        fixedFee: 0,
        supportedCurrencies: ['INR'],
        supportedMethods: ['UPI', 'CARD', 'WALLET', 'NETBANKING'],
        binAffinities: ['4', '5'], // Visa/Mastercard strong affinity
        healthScore: 0.98,
        latency: 120,
        enabled: true,
    },
    stripe: {
        id: 'stripe',
        baseUrl: 'https://api.stripe.com/v1',
        baseFee: 0.029,
        fixedFee: 0.3,
        supportedCurrencies: ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD'],
        supportedMethods: ['CARD'],
        binAffinities: ['3', '4', '5', '6'],
        healthScore: 0.97,
        latency: 180,
        enabled: parseBoolean(process.env.PAYMENT_STRIPE_ROUTING_ENABLED, false),
    },
};

/**
 * Heuristic Routing Solver
 * @param {Object} transaction - Transaction context
 */
const calculateOptimalRoute = async (transaction) => {
    const { amount, currency = 'INR', paymentMethod, bin } = transaction;
    const normalizedMethod = String(paymentMethod || '').trim().toUpperCase();
    
    const candidates = [];
    const logs = [];

    logs.push(`Starting alpha-routing for txn amount: ${amount} ${currency}`);

    // Phase 1: Constraint Filtering
    for (const [id, gw] of Object.entries(GATEWAYS)) {
        if (!gw.enabled) {
            logs.push(`Filtered ${id}: Gateway disabled`);
        } else if (!gw.supportedCurrencies.includes(currency)) {
            logs.push(`Filtered ${id}: Currency mismatch`);
        } else if (normalizedMethod && !gw.supportedMethods.includes(normalizedMethod)) {
            logs.push(`Filtered ${id}: Payment method mismatch`);
        } else {
            candidates.push({ ...gw });
        }
    }

    if (candidates.length === 0) {
        logs.push('No available gateways for these constraints, falling back to primary.');
        return { 
            gatewayId: 'razorpay', 
            routingStrategy: 'fallback_default',
            isOptimized: false 
        };
    }

    // Phase 2: Multi-Factor Scoring (The Heuristic)
    const scoredCandidates = candidates.map(gw => {
        let score = 0;
        
        // 1. Cost Score (Lower is better, inverted for ranking)
        const fee = (amount * gw.baseFee) + gw.fixedFee;
        const costFactor = 1 - (fee / (amount * 0.05)); // Normalized against a 5% cap
        score += costFactor * 0.3; // 30% weight

        // 2. Health & Reliability Score
        score += gw.healthScore * 0.4; // 40% weight (Priority)

        // 3. Affinity Score (BIN/Card Type matching)
        if (bin) {
            const hasAffinity = gw.binAffinities.some(prefix => bin.startsWith(prefix));
            if (hasAffinity) {
                score += 0.2; // 20% bonus for affinity matching
                logs.push(`Affinity match detected for ${gw.id} with BIN ${bin}`);
            }
        }

        // 4. Latency / User Experience Score
        const latencyFactor = 1 - (gw.latency / 500); // Normalized against 500ms
        score += Math.max(0, latencyFactor) * 0.1; // 10% weight

        return { ...gw, finalScore: score };
    });

    // Sort by descending score
    scoredCandidates.sort((a, b) => b.finalScore - a.finalScore);
    const winner = scoredCandidates[0];

    logs.push(`Sorted candidates matches: ${scoredCandidates.map(c => `${c.id}:${c.finalScore.toFixed(3)}`).join(', ')}`);
    logs.push(`Winning route: ${winner.id}`);

    return {
        gatewayId: winner.id,
        routingStrategy: 'multi_factor_heuristic',
        isOptimized: true,
        traceId: crypto.randomBytes(8).toString('hex'),
        insights: {
            score: winner.finalScore,
            expectedLatency: winner.latency,
            estFee: (amount * winner.baseFee) + winner.fixedFee,
            routingLogs: logs
        }
    };
};

module.exports = {
    calculateOptimalRoute,
    GATEWAYS
};
