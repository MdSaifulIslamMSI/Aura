const { buildTrustContext } = require('../trustContext');

const attachTrustContext = (req, _res, next) => {
    req.trustContext = buildTrustContext(req);
    return next();
};

module.exports = {
    attachTrustContext,
};
