const client = require('prom-client');
const { registry } = require('../middleware/metrics');

const getOrCreateMetric = (name, factory) => {
    const existing = typeof registry.getSingleMetric === 'function'
        ? registry.getSingleMetric(name)
        : null;
    return existing || factory();
};

const emergencyFlagActive = getOrCreateMetric('emergency_flag_active', () => new client.Gauge({
    name: 'emergency_flag_active',
    help: 'Whether an emergency flag is currently active.',
    labelNames: ['flagKey'],
    registers: [registry],
}));

const emergencyRequestBlockedTotal = getOrCreateMetric('emergency_request_blocked_total', () => new client.Counter({
    name: 'emergency_request_blocked_total',
    help: 'Total requests blocked by emergency controls.',
    labelNames: ['flagKey', 'route'],
    registers: [registry],
}));

const emergencyAdminActionTotal = getOrCreateMetric('emergency_admin_action_total', () => new client.Counter({
    name: 'emergency_admin_action_total',
    help: 'Total emergency admin actions.',
    labelNames: ['action', 'flagKey'],
    registers: [registry],
}));

const setEmergencyFlagMetric = (flagKey, active) => {
    try {
        emergencyFlagActive.set({ flagKey }, active ? 1 : 0);
    } catch {
        // Metrics should never affect request handling.
    }
};

const recordEmergencyRequestBlocked = ({ flagKey = '', route = '' } = {}) => {
    try {
        emergencyRequestBlockedTotal.inc({ flagKey, route: route || 'unknown' });
    } catch {
        // Metrics should never affect request handling.
    }
};

const recordEmergencyAdminAction = ({ action = '', flagKey = '' } = {}) => {
    try {
        emergencyAdminActionTotal.inc({ action: action || 'unknown', flagKey: flagKey || 'unknown' });
    } catch {
        // Metrics should never affect request handling.
    }
};

module.exports = {
    recordEmergencyAdminAction,
    recordEmergencyRequestBlocked,
    setEmergencyFlagMetric,
};
