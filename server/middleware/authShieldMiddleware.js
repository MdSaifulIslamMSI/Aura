const authShield = require('../security/authShield');
const { buildAuthShieldError } = require('../security/authShield/errors');

const authShieldMiddleware = (options = {}) => async (req, _res, next) => {
    try {
        const decision = await authShield.enforce(req, options);
        req.authShieldDecision = decision;

        if (!decision.enforced) {
            return next();
        }

        return next(buildAuthShieldError(decision));
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    authShieldMiddleware,
};
