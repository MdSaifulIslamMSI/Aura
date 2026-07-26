const { getAccountPrivacyActivation } = require('../config/accountPrivacyFlags');
const AppError = require('../utils/AppError');

const requireAccountPrivacyLifecycle = (_req, _res, next) => {
    const activation = getAccountPrivacyActivation();
    if (!activation.enabled) {
        const error = new AppError('Account privacy lifecycle is not available', 503);
        error.code = 'ACCOUNT_PRIVACY_POLICY_BLOCKED';
        return next(error);
    }
    return next();
};

module.exports = {
    requireAccountPrivacyLifecycle,
};
