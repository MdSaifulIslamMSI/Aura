const { safeString } = require('./assistantContract');

const ORCHESTRATOR_ROUTES = Object.freeze(['LOCAL', 'CENTRAL', 'HYBRID']);

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const normalizeRoute = (value, fallback = 'LOCAL') => {
    const normalized = safeString(value, fallback).toUpperCase();
    return ORCHESTRATOR_ROUTES.includes(normalized) ? normalized : fallback;
};

const normalizeStringList = (values = [], limit = 12) => (
    (Array.isArray(values) ? values : [])
        .map((entry) => safeString(entry))
        .filter(Boolean)
        .slice(0, limit)
);

const normalizeOverrideControls = (overrides = {}) => ({
    forceRoute: normalizeRoute(overrides?.forceRoute || '', ''),
    maxCost: Math.max(0, Number(overrides?.maxCost || 0)),
    latencyBudgetMs: Math.max(0, Number(overrides?.latencyBudgetMs || 0)),
    disabledTools: normalizeStringList(overrides?.disabledTools || [], 16),
});

const buildOrchestratorDecision = (decision = {}) => ({
    route: normalizeRoute(decision?.route || 'LOCAL'),
    confidence: clamp(decision?.confidence, 0, 1),
    cost_estimate: Math.max(0, Number(decision?.cost_estimate || 0)),
    latency_budget_ms: Math.max(0, Number(decision?.latency_budget_ms || 0)),
    requires_confirmation: Boolean(decision?.requires_confirmation),
    reason_summary: safeString(decision?.reason_summary || ''),
    complexity: clamp(decision?.complexity, 0, 1),
    risk: safeString(decision?.risk || ''),
    overrides: normalizeOverrideControls(decision?.overrides || {}),
});

const buildToolProposal = (proposal = {}) => ({
    tools_needed: normalizeStringList(proposal?.tools_needed || [], 16),
    reason: safeString(proposal?.reason || ''),
    max_tool_hops: Math.max(0, Number(proposal?.max_tool_hops || 0)),
});

const buildEvidenceEnvelope = (envelope = {}) => ({
    confidence: clamp(envelope?.confidence, 0, 1),
    verified: Boolean(envelope?.verified),
    conflicts: normalizeStringList(envelope?.conflicts || [], 8),
    sources: Array.isArray(envelope?.sources) ? envelope.sources.slice(0, 12) : [],
});

const buildAuditRecord = (record = {}) => ({
    decisionId: safeString(record?.decisionId || ''),
    traceId: safeString(record?.traceId || ''),
    sessionId: safeString(record?.sessionId || ''),
    route: normalizeRoute(record?.route || 'LOCAL'),
    reasonSummary: safeString(record?.reasonSummary || ''),
    confidence: clamp(record?.confidence, 0, 1),
    costEstimate: Math.max(0, Number(record?.costEstimate || 0)),
    latencyBudgetMs: Math.max(0, Number(record?.latencyBudgetMs || 0)),
    requiresConfirmation: Boolean(record?.requiresConfirmation),
    risk: safeString(record?.risk || ''),
    complexity: clamp(record?.complexity, 0, 1),
    fallbackReason: safeString(record?.fallbackReason || ''),
    confirmationOutcome: safeString(record?.confirmationOutcome || ''),
    models: normalizeStringList(record?.models || [], 8),
    toolProposals: Array.isArray(record?.toolProposals)
        ? record.toolProposals.map((entry) => buildToolProposal(entry)).slice(0, 8)
        : [],
    toolsExecuted: normalizeStringList(record?.toolsExecuted || [], 16),
    overrides: normalizeOverrideControls(record?.overrides || {}),
    provisional: Boolean(record?.provisional),
    upgradeEligible: Boolean(record?.upgradeEligible),
    status: safeString(record?.status || 'completed'),
    startedAt: safeString(record?.startedAt || ''),
    completedAt: safeString(record?.completedAt || ''),
    latencyMs: Math.max(0, Number(record?.latencyMs || 0)),
});

module.exports = {
    ORCHESTRATOR_ROUTES,
    buildAuditRecord,
    buildEvidenceEnvelope,
    buildOrchestratorDecision,
    buildToolProposal,
    normalizeOverrideControls,
    normalizeRoute,
};
