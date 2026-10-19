// Regression guard for the hardcoded status-unsubscribe HMAC fallback.
//
// The unsubscribe token is an HMAC over the subscriber address. While the
// resolver fell back to a PUBLIC CONSTANT outside production, anybody who had
// read the source could mint a valid token for an arbitrary address and
// silently unsubscribed that person from status/security notifications.
//
// The contract asserted here:
//   1. Outside `test`, no secret configured  -> throws (fails closed).
//   2. Outside `test`, a secret configured    -> that exact secret is used.
//   3. In `test`, a deterministic key exists so the suite stays hermetic.
//   4. No runtime may ever resolve to a well-known constant such as
//      'dev-status-unsubscribe-secret'.
const {
    __testables,
} = require('../services/statusService');

const { buildUnsubscribeToken, hasStatusUnsubscribeSecret, resolveStatusUnsubscribeSecret } = __testables;

const FORBIDDEN_FALLBACKS = [
    'dev-status-unsubscribe-secret',
    'test-status-unsubscribe-secret',
];

describe('status unsubscribe secret hardening', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    const setRuntime = (nodeEnv, secret) => {
        process.env = { ...originalEnv, NODE_ENV: nodeEnv };
        if (secret === undefined) {
            delete process.env.STATUS_UNSUBSCRIBE_SECRET;
        } else {
            process.env.STATUS_UNSUBSCRIBE_SECRET = secret;
        }
    };

    test('fails closed when no secret is configured outside test', () => {
        setRuntime('development', undefined);

        expect(() => resolveStatusUnsubscribeSecret()).toThrow(/STATUS_UNSUBSCRIBE_SECRET is required/);
        expect(() => resolveStatusUnsubscribeSecret()).toThrow(/status subscriptions/);
        expect(hasStatusUnsubscribeSecret()).toBe(false);
    });

    test('fails closed in production and staging when no secret is configured', () => {
        for (const nodeEnv of ['production', 'staging', 'stage']) {
            setRuntime(nodeEnv, undefined);

            expect(() => resolveStatusUnsubscribeSecret()).toThrow(/STATUS_UNSUBSCRIBE_SECRET is required/);
            expect(hasStatusUnsubscribeSecret()).toBe(false);
        }
    });

    test('ignores a blank secret instead of treating it as configured', () => {
        setRuntime('development', '   ');

        expect(() => resolveStatusUnsubscribeSecret()).toThrow(/STATUS_UNSUBSCRIBE_SECRET is required/);
        expect(hasStatusUnsubscribeSecret()).toBe(false);
    });

    test('uses the configured secret verbatim when one is provided', () => {
        setRuntime('development', 'configured-status-unsubscribe-secret-value');

        expect(resolveStatusUnsubscribeSecret()).toBe('configured-status-unsubscribe-secret-value');
        expect(hasStatusUnsubscribeSecret()).toBe(true);
    });

    test('the test runtime keeps a deterministic key so the suite stays hermetic', () => {
        setRuntime('test', undefined);

        expect(resolveStatusUnsubscribeSecret()).toBe('test-status-unsubscribe-secret');
        expect(hasStatusUnsubscribeSecret()).toBe(true);
    });

    test('no non-test runtime ever resolves to a well-known constant key', () => {
        for (const nodeEnv of ['development', 'staging', 'production']) {
            setRuntime(nodeEnv, undefined);

            let resolved = '';
            try {
                resolved = resolveStatusUnsubscribeSecret();
            } catch {
                resolved = '';
            }

            expect(FORBIDDEN_FALLBACKS).not.toContain(resolved);
        }
    });

    test('the same address produces different tokens under different secrets', () => {
        setRuntime('development', 'secret-one-value-for-unsubscribe-hmac');
        const first = buildUnsubscribeToken('victim@example.com');

        setRuntime('development', 'secret-two-value-for-unsubscribe-hmac');
        const second = buildUnsubscribeToken('victim@example.com');

        expect(first).not.toBe(second);
    });
});
