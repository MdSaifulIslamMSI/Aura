/**
 * Custom NoSQL Injection Sanitization Middleware
 * Recursively removes any keys starting with "$" or containing "."
 * from req.body, req.query, and req.params
 */
const mongoSanitize = () => {
    const PROHIBITED_KEYS = ['__proto__', 'constructor', 'prototype'];

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

            Object.keys(obj).forEach((key) => {
                if (/^\$/.test(key) || /\./.test(key) || PROHIBITED_KEYS.includes(key)) {
                    delete obj[key];
                } else {
                    obj[key] = sanitize(obj[key], depth + 1);
                }
            });

            return obj;
        };

        if (req.body) sanitize(req.body);
        if (req.query) sanitize(req.query);
        if (req.params) sanitize(req.params);
        if (req.headers) sanitize(req.headers);

        next();
    };
};

module.exports = mongoSanitize;
