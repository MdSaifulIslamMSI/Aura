// Regression guard for the NoSQL sanitizer depth boundary.
//
// The global request sanitizer used to return the sub-tree untouched once the
// recursion budget (12 levels) was exhausted, so a `$`-prefixed key nested
// below that boundary survived into req.body / req.query and reached the
// query layer. The boundary exists to bound the STACK, not to skip the
// sanitisation.
//
// These tests assert:
//   1. A `$` key nested far below the boundary is removed.
//   2. The same is true for the prototype-sensitive keys.
//   3. Behaviour at depths <= 12 is unchanged (the key filter still applies
//      there, and legitimate data is preserved).
//   4. A circular payload still terminates.
const mongoSanitize = require('../middleware/securityMiddleware');

const buildNested = (depth, leaf) => {
    let node = leaf;
    for (let level = depth - 1; level >= 0; level -= 1) {
        node = { [`level${level}`]: node };
    }
    return node;
};

const runSanitizer = (req) => {
    const next = jest.fn();
    mongoSanitize()(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    return req;
};

describe('NoSQL sanitizer depth boundary', () => {
    test('removes a $ prefixed key nested below the depth boundary', () => {
        const body = buildNested(20, { $where: 'this.is.unsafe' });

        const req = runSanitizer({ body, params: {}, headers: {} });

        expect(JSON.stringify(req.body)).not.toContain('$where');
        expect(req.body.level0).toBeDefined();
    });

    test('removes a $ prefixed key nested just below the depth boundary', () => {
        const body = buildNested(13, { $gt: '' });

        const req = runSanitizer({ body, params: {}, headers: {} });

        expect(JSON.stringify(req.body)).not.toContain('$gt');
    });

    test('a prototype sensitive key below the depth boundary is rejected, not laundered', () => {
        const body = buildNested(20, JSON.parse('{"__proto__":{"polluted":true}}'));

        expect(() => runSanitizer({ body, params: {}, headers: {} }))
            .toThrow(/failed security validation/i);
        expect({}.polluted).toBeUndefined();
    });

    test('removes dotted keys nested below the depth boundary', () => {
        const body = buildNested(20, { 'nested.value': 'unsafe' });

        const req = runSanitizer({ body, params: {}, headers: {} });

        expect(JSON.stringify(req.body)).not.toContain('nested.value');
    });

    test('keeps the in-place filter behaviour at depths below the boundary', () => {
        const req = runSanitizer({
            body: JSON.parse('{"profile":{"displayName":"Aura","$where":"unsafe","nested.value":"unsafe"},"keep":"yes"}'),
            params: {},
            headers: {},
        });

        expect(req.body).toEqual({
            profile: { displayName: 'Aura' },
            keep: 'yes',
        });
    });

    test('preserves legitimate values at every depth', () => {
        const body = buildNested(20, { amount: 42, currency: 'INR' });

        const req = runSanitizer({ body, params: {}, headers: {} });

        let node = req.body;
        for (let level = 0; level < 20; level += 1) {
            node = node[`level${level}`];
        }
        expect(node).toEqual({ amount: 42, currency: 'INR' });
    });

    test('a circular payload still terminates instead of overflowing the stack', () => {
        const circular = { name: 'root' };
        circular.self = circular;

        const req = runSanitizer({ body: circular, params: {}, headers: {} });

        expect(req.body).toBeDefined();
        expect(req.body.name).toBe('root');
    });

    test('a circular payload below the depth boundary still terminates', () => {
        const circular = { name: 'deep' };
        circular.self = circular;
        const body = buildNested(20, circular);

        const req = runSanitizer({ body, params: {}, headers: {} });

        expect(req.body).toBeDefined();
    });
});

// The deep sub-tree rebuild was rewritten to build objects with
// `Object.fromEntries` instead of assigning to a computed property, so a
// `__proto__` key can never reach Object.prototype through the inherited
// setter. The rewrite must be observationally identical to the implementation
// it replaced.
//
// The reference below is the pre-rewrite algorithm, kept as the oracle. It is
// deliberately a copy rather than a call into the module: the point is to pin
// the OUTPUT, not to re-run the same code twice.
const referenceRebuild = (root) => {
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
            if (typeof key !== 'string') continue;
            if (key.startsWith('$') || key.includes('.') || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
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

describe('NoSQL sanitizer deep-rebuild equivalence', () => {
    // The rebuild only runs below the recursion budget, so every payload here
    // is nested deep enough to cross it.
    const belowBoundary = (payload) => buildNested(20, payload);

    const serialise = (value) => {
        const seen = new WeakSet();
        return JSON.stringify(value, (key, item) => {
            if (item && typeof item === 'object') {
                if (seen.has(item)) return '[CYCLE]';
                seen.add(item);
            }
            return item;
        });
    };

    const runDeepRebuild = (payload) => {
        const req = runSanitizer({ body: belowBoundary(payload), params: {}, headers: {} });
        // The leaf is the part the deep rebuild produced: the wrappers above
        // it are walked by the shallow, depth-bounded path.
        let node = req.body;
        for (let level = 0; level < 20; level += 1) node = node[`level${level}`];
        return node;
    };

    // The prototype-sensitive keys are deliberately absent: the dedicated
    // payload guard REJECTS a request that carries one, so such a payload
    // never reaches the rebuild. It is covered by its own test below.
    const KEYS = ['a', 'b', '$where', 'nested.value', 'x'];

    const makeValue = (depth) => {
        const roll = (depth * 7 + KEYS.length) % 10;
        if (depth > 3 || roll < 4) {
            if (roll === 0) return null;
            if (roll === 1) return 42;
            if (roll === 2) return 'text';
            return true;
        }
        if (roll < 7) {
            const list = [];
            for (let i = 0; i < roll % 4; i += 1) list.push(makeValue(depth + 1));
            return list;
        }
        const object = {};
        for (let i = 0; i < 4; i += 1) object[KEYS[(depth + i) % KEYS.length]] = makeValue(depth + 1);
        return object;
    };

    test('rebuilds the same tree the previous implementation produced', () => {
        const payloads = [
            { a: 1, b: 'two', c: true, d: null },
            { $where: 'x', 'nested.value': 'y', keep: 1 },
            [1, 'two', null, { a: 1 }],
            { x: { y: { z: [1, 2, { w: 3 }] } } },
            [[1, 2], [3, [4, 5]]],
            {},
            [],
        ];

        // A cycle and a shared node: the first occurrence is rebuilt, every
        // later one becomes an empty placeholder.
        const cyclic = { name: 'root' };
        cyclic.self = cyclic;
        payloads.push(cyclic);
        const shared = { shared: true };
        payloads.push({ a: shared, b: shared });

        // A deterministic sweep of generated payloads, including unsafe keys.
        let seed = 20261021;
        const next = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };
        for (let i = 0; i < 200; i += 1) {
            const length = 1 + Math.floor(next() * 4);
            const object = {};
            for (let j = 0; j < length; j += 1) {
                object[KEYS[Math.floor(next() * KEYS.length)]] = makeValue(Math.floor(next() * 3));
            }
            payloads.push(object);
        }

        for (const payload of payloads) {
            const expected = serialise(referenceRebuild(structuredClone(payload)));
            const actual = serialise(runDeepRebuild(structuredClone(payload)));
            expect(actual).toBe(expected);
        }
    });

    test('a __proto__ key below the boundary never reaches Object.prototype', () => {
        const payload = JSON.parse('{"__proto__":{"polluted":true},"keep":1}');

        // The dedicated prototype-pollution guard rejects the request before
        // the key filter can launder it, so the body never reaches a route.
        expect(() => runSanitizer({ body: belowBoundary(payload), params: {}, headers: {} }))
            .toThrow(/failed security validation/i);
        expect({}.polluted).toBeUndefined();
    });
});
