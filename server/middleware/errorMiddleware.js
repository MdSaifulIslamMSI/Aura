const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { buildMinimizedErrorResponse } = require('../security/invisibleFabric/responseMinimizer');
const {
    buildPrivacySafeRequestLogContext,
    minimizeRequestPath,
} = require('../utils/requestObservability');

const notFound = (req, res, next) => {
    const error = new AppError(`Not Found - ${minimizeRequestPath(req.originalUrl)}`, 404);
    next(error);
};

const errorHandler = (err, req, res, next) => {
    if (res.headersSent || res.writableEnded || res.destroyed) {
        return next(err);
    }

    if (err?.type === 'entity.too.large' || err?.status === 413) {
        return res.status(413).json({
            status: 'error',
            message: 'Payload too large. Reduce image size and try again.',
            requestId: req.requestId || '',
        });
    }

    if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid JSON payload.',
            requestId: req.requestId || '',
        });
    }

    // Priority: 1) err.statusCode (from AppError), 2) res.statusCode (if set), 3) default 500
    const statusCode = err.statusCode || (res.statusCode !== 200 ? res.statusCode : 500);

    // Normalize properties for consistent handling
    err.statusCode = statusCode;
    err.status = err.status || 'error';

    // Log the error for observability as structured JSON
    logger.error(err.message || 'Unhandled Exception', {
        error: err,
        type: err.constructor.name,
        ...buildPrivacySafeRequestLogContext(req),
        statusCode,
    });

    // Guarded: no-op without SENTRY_DSN. Only 5xx (real bugs), never 4xx.
    if (statusCode >= 500) {
        try {
            require('../utils/sentry').captureServerException(err, {
                route: req.originalUrl || req.url || '',
                requestId: req.requestId || '',
                method: req.method || '',
                statusCode,
            });
        } catch {
            // Sentry must never break error responses.
        }
        // Guarded: no-op without DATADOG_API_KEY/DD_API_KEY. Fire-and-forget.
        try {
            void require('../utils/datadog').logToDatadog('error', err.message || 'Unhandled Exception', {
                error: err,
                route: req.originalUrl || req.url || '',
                requestId: req.requestId || '',
                method: req.method || '',
                statusCode,
            });
        } catch {
            // Datadog must never break error responses.
        }
    }

    const minimizedResponse = buildMinimizedErrorResponse({ err, req, statusCode });
    if (minimizedResponse) {
        return res.status(minimizedResponse.statusCode).json(minimizedResponse.body);
    }

    // Send actual error message for:
    // 1) Operational errors (from AppError)
    // 2) Any explicitly set status code (4xx errors from controllers)
    if (err.isOperational || statusCode < 500) {
        return res.status(statusCode).json({
            ...(err.code ? { success: false, code: err.code } : {}),
            ...(err.feature ? { feature: err.feature } : {}),
            ...(err.requiresMfa ? { requiresMfa: true } : {}),
            ...(err.requiresStepUpMfa ? { requiresStepUpMfa: true } : {}),
            ...(err.mfaChallenge ? { mfaChallenge: err.mfaChallenge } : {}),
            ...(err.mfaPolicy ? { mfaPolicy: err.mfaPolicy } : {}),
            status: err.status || 'error',
            message: err.message,
            requestId: req.requestId || '',
        });
    }

    // Programming or other unknown 500 error: don't leak details
    res.status(statusCode).json({
        status: 'error',
        message: 'Something went wrong!',
        requestId: req.requestId || '',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack, error: err })
    });
};

module.exports = { notFound, errorHandler };
