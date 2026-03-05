/**
 * Custom NoSQL Injection Sanitization Middleware
 * Recursively removes any keys starting with "$" or containing "."
 * from req.body, req.query, and req.params
 */
const mongoSanitize = () => {
    return (req, res, next) => {
        const sanitize = (obj) => {
            if (obj instanceof Object) {
                for (const key in obj) {
                    if (/^\$/.test(key) || /\./.test(key)) {
                        delete obj[key];
                    } else {
                        sanitize(obj[key]);
                    }
                }
            }
            return obj;
        };

        if (req.body) sanitize(req.body);
        if (req.query) sanitize(req.query);
        if (req.params) sanitize(req.params);

        next();
    };
};

module.exports = mongoSanitize;
