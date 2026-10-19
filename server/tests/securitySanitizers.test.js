const mongoSanitize = require('../middleware/securityMiddleware');
const xssSanitizer = require('../middleware/xssSanitizer');

describe('request security sanitizers', () => {
    test('NoSQL sanitizer rebuilds objects without operator keys', () => {
        const req = {
            body: JSON.parse('{"profile":{"displayName":"Aura","$where":"unsafe","nested.value":"unsafe"}}'),
            params: {},
            headers: {},
        };
        Object.defineProperty(req, 'query', {
            configurable: true,
            get: () => JSON.parse('{"safe":"yes","$operator":"unsafe"}'),
        });
        const next = jest.fn();

        mongoSanitize()(req, {}, next);

        expect(req.body).toEqual({ profile: { displayName: 'Aura' } });
        expect(req.query).toEqual({ safe: 'yes' });
        expect(next).toHaveBeenCalledTimes(1);
    });

    // The dedicated prototype-pollution guard runs BEFORE the key filter, so a
    // body that carries a prototype-sensitive key is rejected outright instead
    // of being silently stripped into a clean-looking payload.
    test('NoSQL sanitizer rejects a body carrying a prototype-sensitive key', () => {
        const req = {
            body: JSON.parse('{"profile":{"displayName":"Aura","__proto__":{"polluted":true}}}'),
            params: {},
            headers: {},
        };
        const next = jest.fn();

        expect(() => mongoSanitize()(req, {}, next)).toThrow(/failed security validation/i);
        expect(next).not.toHaveBeenCalled();
        expect({}.polluted).toBeUndefined();
    });

    test('XSS sanitizer removes prototype-sensitive keys while escaping strings', () => {
        const req = {
            body: JSON.parse('{"message":"<script>alert(1)</script>","__proto__":{"polluted":true}}'),
            params: {},
        };
        Object.defineProperty(req, 'query', {
            configurable: true,
            get: () => ({ search: '<img src=x onerror=alert(1)>' }),
        });
        const next = jest.fn();

        xssSanitizer(req, {}, next);

        expect(req.body).toEqual({ message: '&lt;script&gt;alert(1)&lt;/script&gt;' });
        expect(req.query.search).not.toContain('onerror=');
        expect({}.polluted).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });
});
