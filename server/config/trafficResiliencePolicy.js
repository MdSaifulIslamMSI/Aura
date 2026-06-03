const fs = require('fs');
const path = require('path');

const TRAFFIC_RESILIENCE_POLICY_PATH = path.resolve(__dirname, '..', '..', 'config', 'security', 'traffic-resilience-policy.json');

const PRODUCTION_FAIL_MODES = new Set(['fail-closed', 'fail-open-safe', 'log-only']);
const COST_RISKS = new Set(['low', 'medium', 'high', 'critical']);
const REQUIRED_FIELDS = [
    'windowSeconds',
    'maxRequests',
    'burst',
    'productionFailMode',
    'auditOnDeny',
    'userMessageCode',
    'rolloutFlag',
    'costRisk',
];

const readTrafficResiliencePolicy = (policyPath = TRAFFIC_RESILIENCE_POLICY_PATH) => {
    const raw = fs.readFileSync(policyPath, 'utf8');
    return JSON.parse(raw);
};

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

const validateTrafficResiliencePolicy = (policy = readTrafficResiliencePolicy()) => {
    const errors = [];
    if (!policy || typeof policy !== 'object') {
        return { valid: false, errors: ['policy must be an object'] };
    }
    if (!policy.categories || typeof policy.categories !== 'object') {
        errors.push('categories must be an object');
    }

    for (const [name, category] of Object.entries(policy.categories || {})) {
        for (const field of REQUIRED_FIELDS) {
            if (!Object.prototype.hasOwnProperty.call(category, field)) {
                errors.push(`${name}.${field} is required`);
            }
        }
        if (!isPositiveInteger(category.windowSeconds)) {
            errors.push(`${name}.windowSeconds must be a positive integer`);
        }
        if (!isPositiveInteger(category.maxRequests)) {
            errors.push(`${name}.maxRequests must be a positive integer`);
        }
        if (!isPositiveInteger(category.burst)) {
            errors.push(`${name}.burst must be a positive integer`);
        }
        if (category.burst > category.maxRequests) {
            errors.push(`${name}.burst must not exceed maxRequests`);
        }
        if (!PRODUCTION_FAIL_MODES.has(category.productionFailMode)) {
            errors.push(`${name}.productionFailMode must be one of ${[...PRODUCTION_FAIL_MODES].join(', ')}`);
        }
        if (typeof category.auditOnDeny !== 'boolean') {
            errors.push(`${name}.auditOnDeny must be boolean`);
        }
        if (!String(category.userMessageCode || '').trim()) {
            errors.push(`${name}.userMessageCode must be non-empty`);
        }
        if (!String(category.rolloutFlag || '').trim()) {
            errors.push(`${name}.rolloutFlag must be non-empty`);
        }
        if (!COST_RISKS.has(category.costRisk)) {
            errors.push(`${name}.costRisk must be one of ${[...COST_RISKS].join(', ')}`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
};

const trafficResiliencePolicy = readTrafficResiliencePolicy();

module.exports = {
    COST_RISKS,
    PRODUCTION_FAIL_MODES,
    REQUIRED_FIELDS,
    TRAFFIC_RESILIENCE_POLICY_PATH,
    readTrafficResiliencePolicy,
    trafficResiliencePolicy,
    validateTrafficResiliencePolicy,
};
