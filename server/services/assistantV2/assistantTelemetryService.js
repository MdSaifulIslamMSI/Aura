const logger = require('../../utils/logger');

const recordAssistantTurn = ({
    session = {},
    intent = '',
    routeContext = {},
    telemetry = {},
    actions = [],
    supportDraft = null,
}) => {
    logger.info('assistant_v2.turn', {
        sessionId: String(session?.id || ''),
        intent: String(intent || ''),
        route: String(routeContext?.path || ''),
        routeLabel: String(routeContext?.label || ''),
        retrievalHits: Number(telemetry?.retrievalHits || 0),
        latencyMs: Number(telemetry?.latencyMs || 0),
        source: String(telemetry?.source || 'rules'),
        actions: Array.isArray(actions) ? actions.map((action) => action.type) : [],
        supportHandoff: Boolean(supportDraft),
    });
};

module.exports = {
    recordAssistantTurn,
};
