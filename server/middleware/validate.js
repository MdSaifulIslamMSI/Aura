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
        logger.warn('request.validation_failed', {
            error: error.message,
            issues: error?.issues || error?.errors || [],
            path: req.originalUrl,
        });
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid request data',
                code: 'VALIDATION_FAILED',
                errors: (error.errors || error.issues).map((e) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
        }
        return res.status(500).json({ message: 'Internal Server Error during validation' });
    }
};

module.exports = validate;
