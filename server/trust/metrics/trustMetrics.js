const counters = {
    decisions: 0,
    byDecision: new Map(),
    byReason: new Map(),
};

const incrementMap = (map, key = '') => {
    const normalized = String(key || 'unknown');
    map.set(normalized, (map.get(normalized) || 0) + 1);
};

const recordTrustMetric = ({ decision = {} } = {}) => {
    counters.decisions += 1;
    incrementMap(counters.byDecision, decision.decision);
    incrementMap(counters.byReason, decision.reason);
};

const getTrustMetricsSnapshot = () => ({
    decisions: counters.decisions,
    byDecision: Object.fromEntries(counters.byDecision),
    byReason: Object.fromEntries(counters.byReason),
});

const resetTrustMetrics = () => {
    counters.decisions = 0;
    counters.byDecision.clear();
    counters.byReason.clear();
};

module.exports = {
    getTrustMetricsSnapshot,
    recordTrustMetric,
    resetTrustMetrics,
};
