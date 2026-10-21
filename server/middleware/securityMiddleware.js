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
     *
     * The rebuild runs in two passes:
     *
     *   1. The first pass discovers the shape of the sub-tree with an
     *      explicit work list - never recursion, so a deep or cyclic payload
     *      cannot exhaust the stack.
     *   2. The second pass materialises the copies bottom-up. A parent is
     *      always discovered before its children, so walking the list
     *      backwards guarantees a child copy exists before its parent needs
     *      it.
     *
     * Objects are built with `Object.fromEntries`, like the shallow path
     * above. That creates OWN properties, so a `__proto__` key can never
     * reach Object.prototype through the inherited setter, and the property
     * name never becomes the target of an assignment.
     */
    const sanitizeSubTree = (root) => {
        if (root === null || typeof root !== 'object') return root;

        // One entry per discovered object, in discovery order.
        const nodes = [];
        // The visited set makes a repeated node terminate: the FIRST
        // occurrence is rebuilt, every later one becomes an empty placeholder
        // of the same shape.
        const visited = new Set([root]);

        nodes.push({ isArray: Array.isArray(root), entries: null });
        const work = [{ source: root, index: 0 }];

        while (work.length > 0) {
            const { source, index } = work.pop();
            const entries = [];

            const consider = (key, value) => {
                if (value === null || typeof value !== 'object') {
                    entries.push({ key, value, childIndex: null });
                    return;
                }
                if (visited.has(value)) {
                    entries.push({
                        key,
                        value: Array.isArray(value) ? [] : {},
                        childIndex: null,
                    });
                    return;
                }
                visited.add(value);
                const childIndex = nodes.length;
                nodes.push({ isArray: Array.isArray(value), entries: null });
                entries.push({ key, value: null, childIndex });
                work.push({ source: value, index: childIndex });
            };

            if (Array.isArray(source)) {
                for (let position = 0; position < source.length; position += 1) {
                    consider(String(position), source[position]);
                }
            } else {
                for (const [key, value] of Object.entries(source)) {
                    if (isUnsafeKey(key)) continue;
                    consider(key, value);
                }
            }
            nodes[index].entries = entries;
        }

        const copies = new Array(nodes.length);
        for (let index = nodes.length - 1; index >= 0; index -= 1) {
            const node = nodes[index];
            const resolved = node.entries.map(({ key, value, childIndex }) => (
                [key, childIndex === null ? value : copies[childIndex]]
            ));
            if (node.isArray) {
                // The source indices are in order, so the copy is built by
                // appending rather than by assigning to a computed index.
                const copy = [];
                for (const [, value] of resolved) copy.push(value);
                copies[index] = copy;
                continue;
            }
            copies[index] = Object.fromEntries(resolved);
        }

        return copies[0];
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
