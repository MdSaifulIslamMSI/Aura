const { getCachedAdaptiveSecuritySignal } = require('../../services/healthService');

const normalizeSystemHealth = (system = {}) => {
    if (!system || Object.keys(system).length === 0) {
        return {
            status: 'ok',
            mode: 'standard',
            degradedSignals: [],
            throttleRiskyWrites: false,
            endpointUnderAbuse: false,
        };
    }

    const degradedSignals = Array.isArray(system.degradedSignals)
        ? system.degradedSignals
        : [];
    const status = system.status || (degradedSignals.length > 0 ? 'degraded' : 'ok');

    return {
        status,
        mode: system.mode || (status === 'degraded' ? 'elevated' : 'standard'),
        degradedSignals,
        throttleRiskyWrites: Boolean(system.throttleRiskyWrites || system.restrictSensitiveActions),
        endpointUnderAbuse: Boolean(system.endpointUnderAbuse),
        selfHealingEnabled: Boolean(system.selfHealingEnabled),
    };
};

const resolveSystemHealth = async ({ system = null, readLive = false } = {}) => {
    if (system) return normalizeSystemHealth(system);
    if (!readLive) return normalizeSystemHealth();

    try {
        const signal = await getCachedAdaptiveSecuritySignal();
        return normalizeSystemHealth(signal);
    } catch {
        return normalizeSystemHealth({
            status: 'degraded',
            degradedSignals: ['health_signal_unavailable'],
            mode: 'elevated',
        });
    }
};

const evaluateSystemHealth = ({ systemHealth = {}, policy = {} } = {}) => {
    const health = normalizeSystemHealth(systemHealth);
    if (health.throttleRiskyWrites && policy.riskyWrite) {
        return {
            ok: false,
            reason: 'SYSTEM_HEALTH_DEGRADED',
            throttle: true,
            health,
        };
    }

    return {
        ok: true,
        reason: health.status === 'degraded' ? 'SYSTEM_HEALTH_OBSERVED' : 'SYSTEM_HEALTH_OK',
        throttle: false,
        health,
    };
};

const applySelfHealingSkeleton = ({ config = {}, decision = {}, route = '' } = {}) => {
    if (!config.selfHealingEnabled) {
        return {
            enabled: false,
            actions: [],
        };
    }

    const actions = [];
    if (['THROTTLE', 'BLOCK', 'QUARANTINE'].includes(decision.decision)) {
        actions.push({
            type: 'incident_event',
            route,
            decisionId: decision.evidence?.decisionId || '',
        });
        actions.push({
            type: 'raise_route_rate_limit_strictness',
            route,
            ttlSeconds: 15 * 60,
        });
    }

    return {
        enabled: true,
        actions,
    };
};

module.exports = {
    applySelfHealingSkeleton,
    evaluateSystemHealth,
    normalizeSystemHealth,
    resolveSystemHealth,
};
