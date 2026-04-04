const crypto = require('crypto');
const { shouldUseCentralIntelligence } = require('../intelligence/intelligenceGatewayService');
const { safeString } = require('./assistantContract');
const {
    buildOrchestratorDecision,
    normalizeOverrideControls,
} = require('./assistantGovernanceContract');

const SYSTEM_COMPLEXITY_PATTERN = /\b(app|architecture|backend|bug|code|component|controller|db|debug|diagnostic|endpoint|error|flow|frontend|graph|health|implementation|issue|model|path|repo|route|schema|service|socket|system|trace|why .*fail)\b/i;
const AMBIGUITY_PATTERN = /\b(this|that|it|they|them|which one|best one|anyone)\b/i;
const HIGH_RISK_PATTERN = /\b(checkout|payment|pay now|place order|buy now|refund|cancel|remove|delete)\b/i;
const MEDIUM_RISK_PATTERN = /\b(add to cart|add this|track order|support|warranty|return|replace)\b/i;

const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const createTraceId = () => `trace_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;

const estimateComplexity = ({
    message = '',
    images = [],
    context = {},
} = {}) => {
    const normalized = safeString(message);
    let complexity = normalized.length > 180 ? 0.55 : 0.2;
    if (SYSTEM_COMPLEXITY_PATTERN.test(normalized)) complexity += 0.45;
    if (AMBIGUITY_PATTERN.test(normalized)) complexity += 0.18;
    if (Array.isArray(images) && images.length > 0) complexity += 0.2;
    if (safeString(context?.route || '').startsWith('/product')) complexity += 0.04;
    return clamp(complexity, 0, 1);
};

const detectRisk = ({
    message = '',
    actionRequest = null,
    confirmation = null,
} = {}) => {
    if (confirmation?.actionId) return 'HIGH';
    const actionType = safeLower(actionRequest?.type || '');
    if (['checkout', 'remove_from_cart', 'add_to_cart'].includes(actionType)) return 'HIGH';
    const normalized = safeString(message);
    if (HIGH_RISK_PATTERN.test(normalized)) return 'HIGH';
    if (MEDIUM_RISK_PATTERN.test(normalized)) return 'MEDIUM';
    return 'LOW';
};

const classifyIntentType = ({
    message = '',
    assistantMode = 'chat',
    context = {},
    actionRequest = null,
    confirmation = null,
} = {}) => {
    if (confirmation?.actionId) return 'confirmation';
    if (actionRequest?.type) return 'explicit_action';
    if (shouldUseCentralIntelligence({
        message,
        assistantMode,
        context,
        confirmation,
        actionRequest,
    })) {
        return 'system_grounded';
    }
    return 'commerce_local';
};

const extractOverrideControls = (context = {}) => normalizeOverrideControls({
    forceRoute: context?.forceRoute || '',
    maxCost: context?.maxCost || 0,
    latencyBudgetMs: context?.latencyBudgetMs || 0,
    disabledTools: context?.disabledTools || [],
});

const buildDecisionReason = ({
    route = 'LOCAL',
    intentType = '',
    complexity = 0,
    risk = 'LOW',
    overrides = {},
} = {}) => {
    if (overrides.forceRoute) {
        return `Forced ${route} route by override control.`;
    }
    if (route === 'HYBRID') {
        return `Need a fast provisional answer plus deeper grounded reasoning for ${intentType} at complexity ${complexity.toFixed(2)}.`;
    }
    if (route === 'CENTRAL') {
        return `Need central-only grounded reasoning for ${intentType} with ${risk.toLowerCase()} risk.`;
    }
    return `Kept the turn local because ${intentType} is low-cost and ${risk.toLowerCase()} risk.`;
};

const buildOrchestratorRouteDecision = ({
    message = '',
    assistantMode = 'chat',
    context = {},
    actionRequest = null,
    confirmation = null,
    images = [],
} = {}) => {
    const overrides = extractOverrideControls(context);
    const complexity = estimateComplexity({
        message,
        images,
        context,
    });
    const risk = detectRisk({
        message,
        actionRequest,
        confirmation,
    });
    const intentType = classifyIntentType({
        message,
        assistantMode,
        context,
        actionRequest,
        confirmation,
    });

    let route = 'LOCAL';
    if (overrides.forceRoute) {
        route = overrides.forceRoute;
    } else if (intentType === 'system_grounded') {
        route = 'HYBRID';
    } else if (intentType === 'explicit_action' || intentType === 'confirmation') {
        route = 'LOCAL';
    } else if (complexity >= 0.85 && risk === 'LOW') {
        route = 'CENTRAL';
    }

    const confidence = overrides.forceRoute
        ? 1
        : route === 'LOCAL'
            ? clamp(0.94 - (complexity * 0.2), 0.55, 0.96)
            : route === 'HYBRID'
                ? clamp(0.82 + (complexity * 0.12), 0.6, 0.97)
                : clamp(0.78 + (complexity * 0.15), 0.6, 0.95);
    const costEstimate = route === 'LOCAL' ? 0.01 : route === 'HYBRID' ? 0.18 : 0.24;
    const latencyBudgetMs = Math.max(
        1200,
        Number(overrides.latencyBudgetMs || (route === 'LOCAL' ? 1800 : route === 'HYBRID' ? 6500 : 12000))
    );

    return buildOrchestratorDecision({
        route,
        confidence,
        cost_estimate: Math.min(
            overrides.maxCost > 0 ? overrides.maxCost : Number.MAX_SAFE_INTEGER,
            costEstimate
        ),
        latency_budget_ms: latencyBudgetMs,
        requires_confirmation: risk === 'HIGH',
        reason_summary: buildDecisionReason({
            route,
            intentType,
            complexity,
            risk,
            overrides,
        }),
        complexity,
        risk,
        overrides,
    });
};

module.exports = {
    buildOrchestratorRouteDecision,
    classifyIntentType,
    createTraceId,
    detectRisk,
    estimateComplexity,
    extractOverrideControls,
};
