const INCIDENT_MODES = Object.freeze({
    NORMAL: 'normal',
    HEIGHTENED: 'heightened',
    LOCKDOWN: 'lockdown',
    MAINTENANCE: 'maintenance',
    RECOVERY: 'recovery',
});

const INCIDENT_WINDOW_MS = 5 * 60 * 1000;
const CRITICAL_EVENT_THRESHOLD = 3;

let currentMode = INCIDENT_MODES.NORMAL;
let criticalDecisionEvents = [];
let incidentEvents = [];

const normalizeMode = (mode = '') => (
    Object.values(INCIDENT_MODES).includes(String(mode || '').trim().toLowerCase())
        ? String(mode).trim().toLowerCase()
        : INCIDENT_MODES.NORMAL
);

const getCurrentMode = () => currentMode;

const setCurrentModeForTests = (mode = INCIDENT_MODES.NORMAL) => {
    currentMode = normalizeMode(mode);
};

const recordCriticalSecurityDecision = ({
    action = '',
    decision = {},
    context = {},
    now = Date.now(),
} = {}) => {
    const riskScore = Number(decision.riskScore || 0);
    if (riskScore < 80) {
        return { mode: currentMode, incidentCreated: false };
    }

    criticalDecisionEvents = criticalDecisionEvents
        .filter((entry) => now - entry.createdAtMs <= INCIDENT_WINDOW_MS)
        .concat([{
            action,
            decision: decision.decision,
            riskScore,
            requestId: context.requestId || '',
            actorId: context.actorId || '',
            createdAtMs: now,
        }]);

    if (
        currentMode === INCIDENT_MODES.NORMAL
        && criticalDecisionEvents.length >= CRITICAL_EVENT_THRESHOLD
    ) {
        currentMode = INCIDENT_MODES.HEIGHTENED;
        incidentEvents.push({
            eventType: 'aura.security_fabric.incident.heightened',
            mode: currentMode,
            reason: 'repeated_critical_security_decisions',
            count: criticalDecisionEvents.length,
            createdAt: new Date(now).toISOString(),
        });
        return { mode: currentMode, incidentCreated: true };
    }

    return { mode: currentMode, incidentCreated: false };
};

const getIncidentEvents = () => [...incidentEvents];

const resetIncidentModeForTests = () => {
    currentMode = INCIDENT_MODES.NORMAL;
    criticalDecisionEvents = [];
    incidentEvents = [];
};

module.exports = {
    INCIDENT_MODES,
    getCurrentMode,
    getIncidentEvents,
    recordCriticalSecurityDecision,
    resetIncidentModeForTests,
    setCurrentModeForTests,
};
