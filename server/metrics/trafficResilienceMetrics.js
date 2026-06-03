const client = require('prom-client');
const { registry } = require('../middleware/metrics');

const getOrCreateCounter = (name, help, labelNames) => {
    const existing = registry.getSingleMetric(name);
    if (existing) return existing;
    return new client.Counter({ name, help, labelNames, registers: [registry] });
};

const getOrCreateGauge = (name, help, labelNames = []) => {
    const existing = registry.getSingleMetric(name);
    if (existing) return existing;
    return new client.Gauge({ name, help, labelNames, registers: [registry] });
};

const trafficBudgetDeniedTotal = getOrCreateCounter(
    'aura_traffic_budget_denied_total',
    'Total requests denied by traffic budget, body, timeout, attack-mode, or load-shedding controls.',
    ['route_class', 'reason']
);

const trafficAbuseEventsTotal = getOrCreateCounter(
    'aura_traffic_abuse_events_total',
    'Total suspicious traffic events by bounded route class and action.',
    ['route_class', 'action']
);

const trafficLoadSheddingState = getOrCreateGauge(
    'aura_traffic_load_shedding_state',
    'Current load-shedding state. 1 means shedding is active.'
);

const trafficCircuitBreakerState = getOrCreateGauge(
    'aura_traffic_circuit_breaker_state',
    'Documented circuit-breaker state by provider. 1 means open/degraded.',
    ['provider']
);

const trafficQueueDepth = getOrCreateGauge(
    'aura_traffic_queue_depth',
    'Queue depth by logical queue when instrumented.',
    ['queue']
);

const recordTrafficBudgetDenied = ({ routeClass = 'unknown', reason = 'unknown' } = {}) => {
    trafficBudgetDeniedTotal.inc({ route_class: routeClass, reason });
};

const recordTrafficAbuseEvent = ({ routeClass = 'unknown', action = 'observed' } = {}) => {
    trafficAbuseEventsTotal.inc({ route_class: routeClass, action });
};

const setTrafficLoadSheddingState = (active = false) => {
    trafficLoadSheddingState.set(active ? 1 : 0);
};

const setTrafficCircuitBreakerState = ({ provider = 'unknown', open = false } = {}) => {
    trafficCircuitBreakerState.set({ provider }, open ? 1 : 0);
};

const setTrafficQueueDepth = ({ queue = 'unknown', depth = 0 } = {}) => {
    trafficQueueDepth.set({ queue }, Number(depth || 0));
};

module.exports = {
    recordTrafficAbuseEvent,
    recordTrafficBudgetDenied,
    setTrafficCircuitBreakerState,
    setTrafficLoadSheddingState,
    setTrafficQueueDepth,
};
