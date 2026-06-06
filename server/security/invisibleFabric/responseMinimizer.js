const { getInvisibleFabricConfig } = require('./config');

const ADMIN_ROUTE_PATTERN = /^\/api\/admin(?:\/|$)/i;
const INTERNAL_DETAIL_PATTERN = /(Mongo|Mongoose|Redis|Postgres|Stripe|Razorpay|Firebase|ENOENT|ECONNREFUSED|stack|node_modules|server\\|server\/|PRIVATE_KEY|SECRET|TOKEN)/i;

const getRequestPath = (req = {}) => String(req.originalUrl || req.path || '').split('?')[0];

const isAdminStepUpError = (err = {}) => (
    Boolean(err.requiresMfa || err.requiresStepUpMfa || err.mfaChallenge || err.mfaPolicy)
    || /STEP_UP|MFA|DUO|WEBAUTHN|PASSKEY/i.test(String(err.code || err.message || ''))
);

const shouldCloakAdminError = ({ err = {}, req = {}, statusCode = 500 } = {}) => {
    const config = getInvisibleFabricConfig();
    if (!config.enabled || !config.cloakAdmin || !ADMIN_ROUTE_PATTERN.test(getRequestPath(req))) {
        return false;
    }
    if (req.user?.isAdmin === true && isAdminStepUpError(err)) {
        return false;
    }
    return statusCode >= 400 && statusCode < 500;
};

const buildMinimizedErrorResponse = ({ err = {}, req = {}, statusCode = 500 } = {}) => {
    const config = getInvisibleFabricConfig();
    const requestId = req.requestId || req.headers?.['x-request-id'] || '';

    if (shouldCloakAdminError({ err, req, statusCode })) {
        return {
            statusCode: 404,
            body: {
                status: 'error',
                message: 'Not found',
                requestId,
            },
        };
    }

    if (!config.enabled || !config.responseMinimization) {
        return null;
    }

    const message = String(err.message || '');
    if (statusCode >= 500 || INTERNAL_DETAIL_PATTERN.test(message)) {
        return {
            statusCode: statusCode >= 400 ? statusCode : 500,
            body: {
                status: 'error',
                message: 'Request failed',
                requestId,
            },
        };
    }

    return null;
};

module.exports = {
    buildMinimizedErrorResponse,
    shouldCloakAdminError,
};
