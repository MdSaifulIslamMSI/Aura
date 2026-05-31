const mongoSanitize = require('../middleware/securityMiddleware');
const xssSanitizer = require('../middleware/xssSanitizer');

describe('request security sanitizers', () => {
    test('NoSQL sanitizer rebuilds objects without operator or prototype-sensitive keys', () => {
        const req = {
            body: JSON.parse('{"profile":{"displayName":"Aura","$where":"unsafe","nested.value":"unsafe","__proto__":{"polluted":true}}}'),
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
        expect({}.polluted).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
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
