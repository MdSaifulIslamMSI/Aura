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
