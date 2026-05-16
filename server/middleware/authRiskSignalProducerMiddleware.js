const {
    extractTrustedLoginRiskSignals,
    stripLoginRiskSignalHeaders,
    writeSignedLoginRiskSignalHeaders,
} = require('../services/authRiskSignalService');
const { extractTrustedDeviceContext } = require('../services/trustedDeviceChallengeService');
const { getTrustedRequestIp } = require('../utils/requestIdentity');
const logger = require('../utils/logger');

const AUTH_SYNC_PATH_PATTERN = /^\/api\/auth\/sync\/?$/i;

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const splitEnvList = (...names) => names
    .flatMap((name) => safeString(process.env[name]).split(/[,;\s]+/))
    .map((entry) => safeString(entry).toLowerCase())
    .filter(Boolean);

const isAuthSyncPath = (req = {}) => {
    const path = safeString(req.path || req.originalUrl || req.url || '').split('?')[0] || '/';
    return AUTH_SYNC_PATH_PATTERN.test(path);
};

const resolveIpReputationFromEnv = (req = {}) => {
    const requestIp = safeString(getTrustedRequestIp(req)).toLowerCase();
    if (!requestIp || requestIp === 'unknown') return '';

    const denylist = new Set(splitEnvList('AUTH_RISK_IP_DENYLIST', 'AUTH_RISK_DENYLIST_IPS'));
    if (denylist.has(requestIp)) return 'denylist';

    const watchlist = new Set(splitEnvList('AUTH_RISK_IP_WATCHLIST', 'AUTH_RISK_WATCHLIST_IPS'));
    if (watchlist.has(requestIp)) return 'watchlist';

    return '';
};

const resolveServerLoginRiskSignals = (req = {}) => {
    const runtimeSignals = req.authRisk && typeof req.authRisk === 'object' ? req.authRisk : {};
    return {
        recentFailureCount: runtimeSignals.recentFailureCount,
        ipReputation: runtimeSignals.ipReputation || resolveIpReputationFromEnv(req),
        impossibleTravel: runtimeSignals.impossibleTravel,
    };
};

const createAuthRiskSignalProducerMiddleware = ({
    resolveSignals = resolveServerLoginRiskSignals,
} = {}) => (req, _res, next) => {
    try {
        if (!isAuthSyncPath(req)) {
            stripLoginRiskSignalHeaders(req);
            return next();
        }

        const { deviceId } = extractTrustedDeviceContext(req);
        const existingSignal = extractTrustedLoginRiskSignals(req, { deviceId });
        if (existingSignal.trusted && existingSignal.source === 'signed_header') {
            req.authRiskSignalProducer = {
                signed: false,
                source: 'upstream_signed_header',
                reason: 'preserved',
            };
            return next();
        }

        if (existingSignal.ignoredUntrustedHeaders) {
            logger.warn('auth_risk_signal.untrusted_headers_stripped', {
                requestId: req.requestId || req.headers?.['x-request-id'] || '',
                reason: existingSignal.reason,
                path: req.originalUrl || req.path,
            });
        }

        stripLoginRiskSignalHeaders(req);
        const result = writeSignedLoginRiskSignalHeaders({
            req,
            deviceId,
            signals: resolveSignals(req),
        });

        req.authRiskSignalProducer = {
            signed: result.signed,
            source: 'server_middleware',
            reason: result.reason,
        };

        return next();
    } catch (error) {
        return next(error);
    }
};

const authRiskSignalProducerMiddleware = createAuthRiskSignalProducerMiddleware();

module.exports = {
    authRiskSignalProducerMiddleware,
    createAuthRiskSignalProducerMiddleware,
    isAuthSyncPath,
    resolveIpReputationFromEnv,
    resolveServerLoginRiskSignals,
};
