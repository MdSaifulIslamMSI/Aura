const xss = require('xss');

/**
 * Express 5 Compatible XSS Sanitizer
 * Recursively sanitizes all string values in req.body, req.query, and req.params
 */
const sanitizeValue = (value) => {
    if (typeof value === 'string') {
        return xss(value);
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeValue);
    }
    if (typeof value === 'object' && value !== null) {
        const sanitized = {};
        for (const key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                sanitized[key] = sanitizeValue(value[key]);
            }
        }
        return sanitized;
    }
    return value;
};

const xssSanitizer = (req, res, next) => {
    if (req.body) {
        req.body = sanitizeValue(req.body);
    }
    if (req.query) {
        req.query = sanitizeValue(req.query);
    }
    if (req.params) {
        req.params = sanitizeValue(req.params);
    }
    next();
};

module.exports = xssSanitizer;
