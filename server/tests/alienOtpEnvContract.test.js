const {
    resolveAlienOtpConfig,
    validateAlienOtpEnv,
} = require('../config/alienOtpConfig');

describe('ALIEN OTP env contract', () => {
    test('defaults off with audit on and short challenge ttl', () => {
        const config = resolveAlienOtpConfig({});

        expect(config.enabled).toBe(false);
        expect(config.sensitiveActionsEnabled).toBe(false);
        expect(config.strictMode).toBe(false);
        expect(config.auditEnabled).toBe(true);
        expect(config.challengeTtlSeconds).toBe(60);
    });

    test('clamps challenge ttl into the approved 30-90 second window', () => {
        expect(resolveAlienOtpConfig({ ALIEN_OTP_CHALLENGE_TTL_SECONDS: '1' }).challengeTtlSeconds).toBe(30);
        expect(resolveAlienOtpConfig({ ALIEN_OTP_CHALLENGE_TTL_SECONDS: '900' }).challengeTtlSeconds).toBe(90);
    });

    test('warns when strict mode has no enabled protected surface', () => {
        const result = validateAlienOtpEnv({
            ALIEN_OTP_ENABLED: 'true',
            ALIEN_OTP_STRICT_MODE: 'true',
        });

        expect(result.valid).toBe(true);
        expect(result.warnings).toContain('ALIEN_OTP_STRICT_MODE=true is configured without a protected ALIEN OTP surface');
    });
});
