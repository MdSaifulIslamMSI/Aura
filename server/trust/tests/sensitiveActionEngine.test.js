const {
    evaluateSensitiveAction,
    hasFreshStepUp,
} = require('../engines/sensitiveActionEngine');

describe('sensitiveActionEngine', () => {
    test('requires passkey step-up when policy demands it', () => {
        const decision = evaluateSensitiveAction({
            actor: { id: 'admin-1', role: 'admin' },
            session: {},
            policy: { sensitive: true, stepUp: 'PASSKEY' },
        });

        expect(decision).toMatchObject({
            ok: false,
            reason: 'STEP_UP_REQUIRED',
            requiredStepUp: 'PASSKEY',
        });
    });

    test('accepts a fresh passkey-backed session', () => {
        expect(hasFreshStepUp({
            requiredStepUp: 'PASSKEY',
            session: {
                stepUpUntil: new Date(Date.now() + 60_000).toISOString(),
                amr: ['webauthn'],
            },
        })).toBe(true);
    });
});
