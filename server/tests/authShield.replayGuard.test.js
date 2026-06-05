const {
    checkReplay,
    resetReplayMemoryForTests,
} = require('../security/authShield/replayGuard');

describe('authShield replay guard', () => {
    const config = {
        replayGuardEnabled: true,
        replayTtlSeconds: 300,
    };

    afterEach(() => resetReplayMemoryForTests());

    test('denies replayed nonce', async () => {
        const first = await checkReplay({
            session: { nonce: 'nonce-1' },
            config,
            sensitivity: 'critical',
        });
        const second = await checkReplay({
            session: { nonce: 'nonce-1' },
            config,
            sensitivity: 'critical',
        });

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(false);
        expect(second.reasons).toContain('replayed_nonce');
    });

    test('critical action requires nonce when replay guard is enabled', async () => {
        const result = await checkReplay({
            session: {},
            config,
            sensitivity: 'critical',
        });

        expect(result.ok).toBe(false);
        expect(result.reasons).toContain('missing_nonce');
    });
});
