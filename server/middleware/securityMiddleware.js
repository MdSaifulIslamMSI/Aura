/**
 * Custom NoSQL Injection Sanitization Middleware
 * Recursively removes any keys starting with "$" or containing "."
 * from req.body, req.query, and req.params
 */
const { validateSensitiveJsonPayload } = require('../security/payloadHardeningService');

const mongoSanitize = () => {
    const PROHIBITED_KEYS = ['__proto__', 'constructor', 'prototype'];
    // Recursion budget for the in-place walk. Sub-trees nested deeper than
    // this are rebuilt by the boundary sanitiser instead of being walked.
    const MAX_DEPTH = 12;

    const isUnsafeKey = (key) => (
        /^\$/.test(key) || /\./.test(key) || PROHIBITED_KEYS.includes(key)
    );

    /**
     * Rebuilds a sub-tree with the SAME key filter, using an explicit work
     * list instead of recursion.
     *
     * WHY THIS EXISTS: the depth boundary used to hand the raw sub-tree back
     * untouched, so a `$`-prefixed key (or a `__proto__` key) nested below
     * the boundary survived into req.body / req.query and reached the query
     * layer. The boundary exists to bound the STACK, not to skip the
     * sanitisation, so the value it returns is rebuilt key by key here.
     */
    const sanitizeSubTree = (root) => {
        if (root === null || typeof root !== 'object') return root;

        const rootCopy = Array.isArray(root) ? [] : {};
        const visited = new Set([root]);
        const queue = [{ source: root, target: rootCopy }];

        while (queue.length > 0) {
            const { source, target } = queue.pop();

            if (Array.isArray(source)) {
                for (let index = 0; index < source.length; index += 1) {
                    const value = source[index];
                    if (value === null || typeof value !== 'object') {
                        target[index] = value;
                        continue;
                    }
                    // A repeated node is a cycle: break it rather than walk
                    // it again, so the work list always terminates.
                    if (visited.has(value)) {
                        target[index] = Array.isArray(value) ? [] : {};
                        continue;
                    }
                    visited.add(value);
                    const copy = Array.isArray(value) ? [] : {};
                    target[index] = copy;
                    queue.push({ source: value, target: copy });
                }
                continue;
            }

            for (const [key, value] of Object.entries(source)) {
                if (isUnsafeKey(key)) continue;
                if (value === null || typeof value !== 'object') {
                    target[key] = value;
                    continue;
                }
                if (visited.has(value)) {
                    target[key] = Array.isArray(value) ? [] : {};
                    continue;
                }
                visited.add(value);
                const copy = Array.isArray(value) ? [] : {};
                target[key] = copy;
                queue.push({ source: value, target: copy });
            }
        }

        return rootCopy;
    };

    return (req, res, next) => {
        const sanitize = (obj, depth = 0) => {
            // Prevent stack overflow on circular refs — but the boundary must
            // not launder tainted keys through: rebuild the sub-tree with the
            // same filter instead of returning it as-is.
            if (depth > MAX_DEPTH) return sanitizeSubTree(obj);
            if (obj === null || typeof obj !== 'object') return obj;

            if (Array.isArray(obj)) {
                for (let i = 0; i < obj.length; i++) {
                    obj[i] = sanitize(obj[i], depth + 1);
                }
                return obj;
            }

            return Object.fromEntries(
                Object.entries(obj)
                    .filter(([key]) => !isUnsafeKey(key))
                    .map(([key, value]) => [key, sanitize(value, depth + 1)])
            );
        };

        const replaceQuery = (req, value) => Object.defineProperty(req, 'query', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
        });

        // The dedicated prototype-pollution guard (security/payloadHardeningService)
        // has to run BEFORE the key filter below: the filter silently drops
        // `__proto__`/`constructor`/`prototype`, so a request carrying one
        // would be laundered into a clean-looking body and the dedicated
        // guard would never see it. Rejecting is stronger than stripping —
        // a body that needs a prototype-pollution key is not a body this API
        // should accept at all.
        //
        // `allowedFields` stays empty on purpose: the accepted field set is
        // route-specific and is owned by the route validators, so the global
        // guard only enforces the dangerous-key rule. `requirePlainObject` is
        // off because express.json() also produces array bodies, which a
        // global plain-object requirement would reject.
        if (req.body && typeof req.body === 'object') {
            validateSensitiveJsonPayload({
                payload: req.body,
                allowedFields: [],
                req,
                rejectUnknownFields: false,
                requirePlainObject: false,
            });
        }

        if (req.body) req.body = sanitize(req.body);
        if (req.query) replaceQuery(req, sanitize(req.query));
        if (req.params) req.params = sanitize(req.params);
        if (req.headers) req.headers = sanitize(req.headers);

        next();
    };
};

module.exports = mongoSanitize;
