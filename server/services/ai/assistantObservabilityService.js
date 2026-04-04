const client = require('prom-client');
const { context: otelContext, trace } = (() => {
    try {
        return require('@opentelemetry/api');
    } catch {
        return {
            context: {
                active: () => ({}),
                with: (_ctx, fn) => fn(),
            },
            trace: {
                getTracer: () => ({
                    startActiveSpan: (_name, _options, _ctx, fn) => fn({
                        setAttribute: () => {},
                        setAttributes: () => {},
                        recordException: () => {},
                        end: () => {},
                    }),
                }),
            },
        };
    }
})();

const { registry } = require('../../middleware/metrics');

const ensureMetric = (metricFactory, config) => {
    const existing = registry.getSingleMetric(config.name);
    if (existing) {
        return existing;
    }
    return new metricFactory({
        ...config,
        registers: [registry],
    });
};

const assistantRouteCounter = ensureMetric(client.Counter, {
    name: 'aura_assistant_route_total',
    help: 'Assistant route decisions by final route and mode',
    labelNames: ['route', 'assistant_mode'],
});

const assistantFallbackCounter = ensureMetric(client.Counter, {
    name: 'aura_assistant_fallback_total',
    help: 'Assistant fallback reasons',
    labelNames: ['reason'],
});

const assistantLatencyHistogram = ensureMetric(client.Histogram, {
    name: 'aura_assistant_turn_latency_seconds',
    help: 'Assistant turn latency in seconds',
    labelNames: ['route', 'provisional'],
    buckets: [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 12],
});

const assistantCostHistogram = ensureMetric(client.Histogram, {
    name: 'aura_assistant_cost_estimate',
    help: 'Assistant per-turn cost estimate',
    labelNames: ['route'],
    buckets: [0.001, 0.01, 0.025, 0.05, 0.1, 0.5, 1, 2],
});

const assistantToolCounter = ensureMetric(client.Counter, {
    name: 'aura_assistant_tool_validation_total',
    help: 'Assistant tool validation results',
    labelNames: ['tool', 'result'],
});

const assistantConfirmationCounter = ensureMetric(client.Counter, {
    name: 'aura_assistant_confirmation_total',
    help: 'Assistant confirmation outcomes',
    labelNames: ['outcome'],
});

const tracer = trace.getTracer('aura-assistant-governance');

const startAssistantSpan = ({ name = 'assistant.turn', attributes = {} } = {}) => (
    tracer.startActiveSpan(
        name,
        {},
        otelContext.active(),
        (span) => {
            span.setAttributes(attributes);
            return span;
        }
    )
);

const recordRouteDecisionMetric = ({ route = 'LOCAL', assistantMode = 'chat' } = {}) => {
    assistantRouteCounter.inc({
        route: String(route || 'LOCAL'),
        assistant_mode: String(assistantMode || 'chat'),
    });
};

const recordFallbackMetric = (reason = '') => {
    if (!reason) return;
    assistantFallbackCounter.inc({
        reason: String(reason),
    });
};

const recordLatencyMetric = ({ route = 'LOCAL', provisional = false, latencyMs = 0 } = {}) => {
    assistantLatencyHistogram.observe({
        route: String(route || 'LOCAL'),
        provisional: provisional ? 'true' : 'false',
    }, Math.max(0, Number(latencyMs || 0)) / 1000);
};

const recordCostMetric = ({ route = 'LOCAL', costEstimate = 0 } = {}) => {
    assistantCostHistogram.observe({
        route: String(route || 'LOCAL'),
    }, Math.max(0, Number(costEstimate || 0)));
};

const recordToolValidationMetric = ({ tool = '', ok = false } = {}) => {
    assistantToolCounter.inc({
        tool: String(tool || 'unknown'),
        result: ok ? 'approved' : 'blocked',
    });
};

const recordConfirmationMetric = (outcome = '') => {
    if (!outcome) return;
    assistantConfirmationCounter.inc({
        outcome: String(outcome),
    });
};

module.exports = {
    recordConfirmationMetric,
    recordCostMetric,
    recordFallbackMetric,
    recordLatencyMetric,
    recordRouteDecisionMetric,
    recordToolValidationMetric,
    startAssistantSpan,
};
