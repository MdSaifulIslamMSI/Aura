// Regression guard for the admin/internal route cloak.
//
// The cloak answers 404 to anonymous probes of admin/internal routes so the
// route surface cannot be enumerated. It used to switch itself off for ANY
// auth material — a bare "Bearer " prefix or any "aura_sid=" cookie was
// enough — so an anonymous prober could send garbage and learn that the
// route exists.
//
// These tests assert:
//   1. Empty / placeholder auth material no longer disables the cloak.
//   2. Plausible auth material still lets the request through to the route.
//   3. The cloak is an anti-probing control only: the route's own
//      authentication still applies (documented, not weakened here).
const {
    hasAuthMaterial,
} = require('../middleware/invisibleFabricMiddleware');

const buildReq = ({ authorization = '', cookie = '' } = {}) => ({
    headers: {
        ...(authorization ? { authorization } : {}),
        ...(cookie ? { cookie } : {}),
    },
});

describe('invisible fabric cloak auth material detection', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    test('a bare bearer prefix is not auth material', () => {
        expect(hasAuthMaterial(buildReq({ authorization: 'Bearer ' }))).toBe(false);
        expect(hasAuthMaterial(buildReq({ authorization: 'Bearer' }))).toBe(false);
        expect(hasAuthMaterial(buildReq({ authorization: 'bearer ' }))).toBe(false);
    });

    test('a bearer token with a value is auth material', () => {
        expect(hasAuthMaterial(buildReq({ authorization: 'Bearer fake-token' }))).toBe(true);
        expect(hasAuthMaterial(buildReq({ authorization: 'bearer fake-token' }))).toBe(true);
        expect(hasAuthMaterial(buildReq({ authorization: 'Bearer  spaced-token' }))).toBe(true);
    });

    test('an empty session cookie is not auth material', () => {
        expect(hasAuthMaterial(buildReq({ cookie: 'aura_sid=' }))).toBe(false);
        expect(hasAuthMaterial(buildReq({ cookie: 'aura_sid=;' }))).toBe(false);
    });

    test('a malformed session cookie value is not auth material', () => {
        expect(hasAuthMaterial(buildReq({ cookie: 'aura_sid=x' }))).toBe(false);
        expect(hasAuthMaterial(buildReq({ cookie: 'aura_sid=has spaces' }))).toBe(false);
    });

    test('a well formed session cookie value is auth material', () => {
        expect(hasAuthMaterial(buildReq({ cookie: 'aura_sid=session-cookie-1' }))).toBe(true);
        expect(hasAuthMaterial(buildReq({ cookie: 'foo=1; aura_sid=session-cookie-1; bar=2' }))).toBe(true);
        expect(hasAuthMaterial(buildReq({ cookie: 'aura_sid=Ab3-_xyz.123' }))).toBe(true);
    });

    test('the session cookie name follows the configured name', () => {
        process.env = { ...originalEnv, AUTH_SESSION_COOKIE_NAME: 'aura_custom_sid' };

        expect(hasAuthMaterial(buildReq({ cookie: 'aura_sid=session-cookie-1' }))).toBe(false);
        expect(hasAuthMaterial(buildReq({ cookie: 'aura_custom_sid=session-cookie-1' }))).toBe(true);
    });

    test('a request without any auth material is not auth material', () => {
        expect(hasAuthMaterial(buildReq())).toBe(false);
        expect(hasAuthMaterial({})).toBe(false);
    });
});
