const { isAdminSecurityContinuationPath } = require('../middleware/authMiddleware');

const req = (method, originalUrl) => ({ method, originalUrl });

describe('admin security continuation path allowlist', () => {
    test.each([
        ['GET', '/api/admin/security/status'],
        ['POST', '/api/admin/security/recovery/exchange'],
        ['POST', '/api/admin/security/passkeys/enrollment/options'],
        ['POST', '/api/admin/security/passkeys/enrollment/verify'],
        ['POST', '/api/admin/security/passkeys/challenge/options'],
        ['POST', '/api/admin/security/passkeys/challenge/verify'],
    ])('allows only %s %s', (method, path) => {
        expect(isAdminSecurityContinuationPath(req(method, path))).toBe(true);
    });

    test.each([
        ['POST', '/api/admin/security/status'],
        ['GET', '/api/admin/security/recovery/exchange'],
        ['GET', '/api/admin/security/passkeys/enrollment/options'],
        ['POST', '/api/admin/security/status/anything'],
        ['POST', '/api/admin/security/recovery/exchange/anything'],
        ['POST', '/api/admin/users'],
    ])('rejects non-allowlisted %s %s', (method, path) => {
        expect(isAdminSecurityContinuationPath(req(method, path))).toBe(false);
    });
});
