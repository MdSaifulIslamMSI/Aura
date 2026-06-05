const crypto = require('crypto');
const { getInvisibleFabricConfig } = require('../security/invisibleFabric/config');
const { recordSecurityAuditEvent } = require('../services/securityAuditService');
const logger = require('../utils/logger');
const { getTrustedRequestIp } = require('../utils/requestIdentity');

const timingSafeEqualText = (candidate = '', expected = '') => {
    const candidateBuffer = Buffer.from(String(candidate || ''));
    const expectedBuffer = Buffer.from(String(expected || ''));
    return candidateBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
};

const buildGenericDeniedBody = (req = {}) => ({
    status: 'error',
    message: 'Not found',
    requestId: req.requestId || req.headers?.['x-request-id'] || '',
});

const trustedEdgeMiddleware = (req, res, next) => {
    const config = getInvisibleFabricConfig();
    if (!config.enabled || !config.requireTrustedEdge) {
        return next();
    }

    const expectedSecret = config.trustedEdgeSecret;
    const providedSecret = String(req.get?.(config.trustedEdgeHeader) || '').trim();
    if (expectedSecret && providedSecret && timingSafeEqualText(providedSecret, expectedSecret)) {
        return next();
    }

    const requestId = req.requestId || req.headers?.['x-request-id'] || '';
    logger.warn('invisible_fabric.trusted_edge_rejected', {
        requestId,
        method: req.method,
        path: req.originalUrl || req.path,
        ip: getTrustedRequestIp(req),
    });
    if (config.auditEnabled) {
        recordSecurityAuditEvent({
            event: 'invisible_fabric.trusted_edge.denied',
            req,
            action: 'trusted_edge.verify',
            result: 'denied',
            reasonCode: 'trusted_edge_header_invalid',
            riskLevel: 'high',
        });
    }

    res.set('Cache-Control', 'no-store');
    return res.status(404).json(buildGenericDeniedBody(req));
};

module.exports = {
    buildGenericDeniedBody,
    timingSafeEqualText,
    trustedEdgeMiddleware,
};
