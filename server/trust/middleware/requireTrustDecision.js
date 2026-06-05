const trustFabric = require('../trustFabric');
const { buildTrustContext } = require('../trustContext');
const { recordTrustDecision } = require('../audit/trustAuditLogger');
const { denyTrustDecision } = require('./denyTrustDecision');

const resolveActor = (req = {}, options = {}) => {
    if (typeof options.actor === 'function') return options.actor(req);
    if (options.actor) return options.actor;
    return req.user || req.actor || null;
};

const requireTrustDecision = (action, resourceLoader = null, options = {}) => async (req, res, next) => {
    try {
        req.trustContext = req.trustContext || buildTrustContext(req);
        const resource = typeof resourceLoader === 'function'
            ? await resourceLoader(req)
            : resourceLoader || options.resource || null;
        const decision = await trustFabric.evaluate({
            actor: resolveActor(req, options),
            action,
            resource,
            request: {
                ...req.trustContext,
                headers: req.headers,
                originalUrl: req.originalUrl,
                url: req.url,
                path: req.path,
                method: req.method,
                requestId: req.requestId || req.trustContext.requestId,
            },
            session: options.session ? options.session(req) : req.authSession || req.session || null,
            device: options.device ? options.device(req) : req.trustedDevice || req.device || null,
            system: options.system ? await options.system(req) : null,
            mode: options.mode,
            config: options.config || {},
            rateSignals: options.rateSignals ? await options.rateSignals(req) : {},
        });
        req.trustDecision = decision;
        recordTrustDecision({
            req,
            decision,
            metadata: options.auditMeta || {},
        });

        if (!decision.allowed) {
            return denyTrustDecision(decision)(req, res, next);
        }

        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    requireTrustDecision,
};
