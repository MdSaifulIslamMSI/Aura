/**
 * Custom NoSQL Injection Sanitization Middleware
 * Recursively removes any keys starting with "$" or containing "."
 * from req.body, req.query, and req.params
 */
const mongoSanitize = () => {
    const PROHIBITED_KEYS = ['__proto__', 'constructor', 'prototype'];
    const replaceQuery = (req, value) => Object.defineProperty(req, 'query', {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    });

    return (req, res, next) => {
        const sanitize = (obj, depth = 0) => {
            if (depth > 12) return obj; // Prevent stack overflow on circular refs
            if (obj === null || typeof obj !== 'object') return obj;

            if (Array.isArray(obj)) {
                for (let i = 0; i < obj.length; i++) {
                    obj[i] = sanitize(obj[i], depth + 1);
                }
                return obj;
            }

            return Object.fromEntries(
                Object.entries(obj)
                    .filter(([key]) => !/^\$/.test(key) && !/\./.test(key) && !PROHIBITED_KEYS.includes(key))
                    .map(([key, value]) => [key, sanitize(value, depth + 1)])
            );
        };

        if (req.body) req.body = sanitize(req.body);
        if (req.query) replaceQuery(req, sanitize(req.query));
        if (req.params) req.params = sanitize(req.params);
        if (req.headers) req.headers = sanitize(req.headers);

        next();
    };
};

module.exports = mongoSanitize;
