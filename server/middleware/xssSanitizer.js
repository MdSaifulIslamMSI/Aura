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
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key))
                .map(([key, entryValue]) => [key, sanitizeValue(entryValue)])
        );
    }
    return value;
};

const replaceQuery = (req, value) => Object.defineProperty(req, 'query', {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
});

const xssSanitizer = (req, res, next) => {
    if (req.body) {
        req.body = sanitizeValue(req.body);
    }
    if (req.query) {
        replaceQuery(req, sanitizeValue(req.query));
    }
    if (req.params) {
        req.params = sanitizeValue(req.params);
    }
    next();
};

module.exports = xssSanitizer;
