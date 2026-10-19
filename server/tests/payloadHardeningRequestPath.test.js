// Regression guard for the prototype-pollution payload guard.
//
// server/security/payloadHardeningService.js exports
// validateSensitiveJsonPayload() — a control that rejects bodies carrying
// `__proto__` / `constructor` / `prototype` keys — but nothing ever called
// it, so the dedicated guard was dead code while the global NoSQL sanitizer
// silently STRIPPED those keys instead of rejecting the request.
//
// These tests assert that the global request-sanitizer middleware now runs
// the dedicated guard on req.body and that a tainted body is rejected rather
// than laundered into a clean-looking payload.
const mongoSanitize = require('../middleware/securityMiddleware');

const runSanitizer = (req) => {
    const next = jest.fn();
    mongoSanitize()(req, {}, next);
    return { next };
};

describe('global request sanitizer prototype-pollution guard', () => {
    test('rejects a body carrying a __proto__ key', () => {
        const req = {
            body: JSON.parse('{"email":"victim@example.com","__proto__":{"isAdmin":true}}'),
            params: {},
            headers: {},
        };

        expect(() => runSanitizer(req)).toThrow(/failed security validation/i);
    });

    test('rejects a nested __proto__ key', () => {
        const req = {
            body: JSON.parse('{"profile":{"__proto__":{"isAdmin":true}}}'),
            params: {},
            headers: {},
        };

        expect(() => runSanitizer(req)).toThrow(/failed security validation/i);
    });

    test('rejects a body carrying a constructor key', () => {
        const req = {
            body: JSON.parse('{"constructor":{"prototype":{"isAdmin":true}}}'),
            params: {},
            headers: {},
        };

        expect(() => runSanitizer(req)).toThrow(/failed security validation/i);
    });

    test('rejects a body carrying a prototype key', () => {
        const req = {
            body: JSON.parse('{"prototype":{"isAdmin":true}}'),
            params: {},
            headers: {},
        };

        expect(() => runSanitizer(req)).toThrow(/failed security validation/i);
    });

    test('rejects a tainted key inside an array body', () => {
        const req = {
            body: JSON.parse('[{"name":"ok"},{"__proto__":{"isAdmin":true}}]'),
            params: {},
            headers: {},
        };

        expect(() => runSanitizer(req)).toThrow(/failed security validation/i);
    });

    test('the rejection carries a 400 status code and a machine readable code', () => {
        const req = {
            body: JSON.parse('{"__proto__":{"isAdmin":true}}'),
            params: {},
            headers: {},
        };

        let thrown = null;
        try {
            runSanitizer(req);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).not.toBeNull();
        expect(thrown.statusCode).toBe(400);
        expect(thrown.code).toBe('DANGEROUS_PAYLOAD_KEY');
    });

    test('a clean body is still accepted and sanitized as before', () => {
        const req = {
            body: JSON.parse('{"email":"victim@example.com","$where":"unsafe"}'),
            params: {},
            headers: {},
        };

        const { next } = runSanitizer(req);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.body).toEqual({ email: 'victim@example.com' });
    });

    test('a body without any payload at all is not rejected', () => {
        const req = { params: {}, headers: {} };

        const { next } = runSanitizer(req);

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('a self referencing payload terminates instead of overflowing the stack', () => {
        const circular = { name: 'root' };
        circular.self = circular;
        const req = { body: circular, params: {}, headers: {} };

        const { next } = runSanitizer(req);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.body).toBeDefined();
    });
});
