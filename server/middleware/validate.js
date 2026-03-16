const { z } = require('zod');
const logger = require('../utils/logger');

const validate = (schema) => async (req, res, next) => {
    try {
        const parsed = await schema.parseAsync({
            body: req.body,
            query: req.query,
            params: req.params,
        });
        req.body = parsed.body || req.body;
        req.query = parsed.query || req.query;
        req.params = parsed.params || req.params;
        return next();
    } catch (error) {
        if (error instanceof z.ZodError) {
            const validationContext = {
                error: error.message,
                issues: error?.issues || error?.errors || [],
                path: req.originalUrl,
            };
            if (process.env.LOG_VALIDATION_WARNINGS === 'true') {
                logger.warn('request.validation_failed', validationContext);
            } else {
                logger.debug('request.validation_failed', validationContext);
            }

            return res.status(400).json({
                status: 'error',
                message: 'Validation Error',
                code: 'VALIDATION_FAILED',
                errors: (error.errors || error.issues).map((e) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
        }

        logger.error('request.validation_unexpected_error', {
            error: error?.message,
            path: req.originalUrl,
        });
        return res.status(500).json({ message: 'Internal Server Error during validation' });
    }
};

module.exports = validate;
