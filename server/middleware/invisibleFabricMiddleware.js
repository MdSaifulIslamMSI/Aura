const { getInvisibleFabricConfig } = require('../security/invisibleFabric/config');
const { recordSecurityAuditEvent } = require('../services/securityAuditService');

const ADMIN_ROUTE_PATTERN = /^\/api\/admin(?:\/|$)/i;
const INTERNAL_ROUTE_PATTERN = /^\/api\/(?:internal|observability)(?:\/|$)/i;
const DEBUG_ROUTE_PATTERN = /(^|\/)(?:debug|server-status)(?:\/|$)/i;
const HONEYPOT_PATHS = new Set([
    '/.env',
    '/.git/config',
    '/wp-admin',
    '/admin-old',
    '/debug',
    '/server-status',
    '/phpmyadmin',
]);

const normalizePath = (req = {}) => String(req.path || req.originalUrl || '/').split('?')[0] || '/';

const hasAuthMaterial = (req = {}) => {
    const authorization = String(req.headers?.authorization || '').trim();
    const cookie = String(req.headers?.cookie || '').trim();
    return authorization.startsWith('Bearer ') || /\baura_sid=/.test(cookie);
};

const sendCloakedNotFound = (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.status(404).json({
        status: 'error',
        message: 'Not found',
        requestId: req.requestId || req.headers?.['x-request-id'] || '',
    });
};

const recordFabricEvent = ({ req, event, reasonCode, action, riskLevel = 'medium' } = {}) => {
    const config = getInvisibleFabricConfig();
    if (!config.auditEnabled) return;
    recordSecurityAuditEvent({
        event,
        req,
        action,
        result: 'blocked',
        reasonCode,
        riskLevel,
        meta: {
            classification: req.invisibleRouteClassification || '',
            riskScore: req.invisibleRiskScore || 0,
        },
    });
};

const adminCloakMiddleware = (req, res, next) => {
    const config = getInvisibleFabricConfig();
    const path = normalizePath(req);
    if (!config.enabled || !config.cloakAdmin || !ADMIN_ROUTE_PATTERN.test(path) || hasAuthMaterial(req)) {
        return next();
    }

    req.invisibleRouteClassification = 'admin';
    recordFabricEvent({
        req,
        event: 'invisible_fabric.admin_cloak.denied',
        reasonCode: 'anonymous_admin_probe',
        action: 'admin.cloak',
        riskLevel: 'high',
    });
    return sendCloakedNotFound(req, res);
};

const internalRouteCloakMiddleware = (req, res, next) => {
    const config = getInvisibleFabricConfig();
    const path = normalizePath(req);
    if (!config.enabled || !config.cloakInternalRoutes || !INTERNAL_ROUTE_PATTERN.test(path) || hasAuthMaterial(req)) {
        return next();
    }

    req.invisibleRouteClassification = 'internal';
    recordFabricEvent({
        req,
        event: 'invisible_fabric.internal_cloak.denied',
        reasonCode: 'anonymous_internal_probe',
        action: 'internal.cloak',
        riskLevel: 'high',
    });
    return sendCloakedNotFound(req, res);
};

const honeypotMiddleware = (req, res, next) => {
    const config = getInvisibleFabricConfig();
    const path = normalizePath(req).replace(/\/+$/, '') || '/';
    if (!config.enabled || !config.honeypotsEnabled || !HONEYPOT_PATHS.has(path)) {
        return next();
    }

    req.invisibleRouteClassification = 'honeypot';
    req.invisibleRiskScore = Math.max(Number(req.invisibleRiskScore || 0), 90);
    recordFabricEvent({
        req,
        event: 'invisible_fabric.honeypot.touched',
        reasonCode: 'honeypot_route_requested',
        action: 'honeypot.request',
        riskLevel: 'high',
    });
    return sendCloakedNotFound(req, res);
};

const blockProductionDebugRoutes = (req, res, next) => {
    const config = getInvisibleFabricConfig();
    const path = normalizePath(req);
    if (!config.enabled || !config.production || !config.blockProdDebug || !DEBUG_ROUTE_PATTERN.test(path)) {
        return next();
    }
    if (HONEYPOT_PATHS.has(path)) {
        return next();
    }

    req.invisibleRouteClassification = 'disabled';
    recordFabricEvent({
        req,
        event: 'invisible_fabric.production_debug.blocked',
        reasonCode: 'production_debug_route',
        action: 'debug.block',
        riskLevel: 'critical',
    });
    return sendCloakedNotFound(req, res);
};

module.exports = {
    adminCloakMiddleware,
    blockProductionDebugRoutes,
    hasAuthMaterial,
    honeypotMiddleware,
    internalRouteCloakMiddleware,
    sendCloakedNotFound,
};
