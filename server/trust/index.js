const trustFabric = require('./trustFabric');
const { requireTrustDecision } = require('./middleware/requireTrustDecision');
const { attachTrustContext } = require('./middleware/attachTrustContext');
const { denyTrustDecision } = require('./middleware/denyTrustDecision');

module.exports = {
    trustFabric,
    evaluate: trustFabric.evaluate,
    requireTrustDecision,
    attachTrustContext,
    denyTrustDecision,
};
