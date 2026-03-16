const {
    diff,
    buildSecurityState,
    setSecurityState,
    getLockUntilDate,
    assertQuoteMatches,
    isIntentExpired,
    assertConfirmNotLocked,
} = require('../services/payments/securityGuards');

describe('payment security guards', () => {
    test('buildSecurityState normalizes missing state and setSecurityState merges updates', () => {
        const intent = {
            metadata: {
                existing: true,
                securityLayer: {
                    failedConfirmAttempts: '2',
                    totalConfirmFailures: '3',
                    lastConfirmFailedAt: '2026-03-01T00:00:00.000Z',
                    lastConfirmFailureReason: 'old',
                },
            },
            markModified: jest.fn(),
        };

        expect(buildSecurityState(intent)).toEqual({
            failedConfirmAttempts: 2,
            totalConfirmFailures: 3,
            lastConfirmFailedAt: '2026-03-01T00:00:00.000Z',
            lastConfirmFailureReason: 'old',
            lockedUntil: null,
        });

        setSecurityState(intent, {
            totalConfirmFailures: 4,
            lockedUntil: '2026-03-10T00:00:00.000Z',
        });

        expect(intent.metadata).toEqual({
            existing: true,
            securityLayer: {
                failedConfirmAttempts: 2,
                totalConfirmFailures: 4,
                lastConfirmFailedAt: '2026-03-01T00:00:00.000Z',
                lastConfirmFailureReason: 'old',
                lockedUntil: '2026-03-10T00:00:00.000Z',
            },
        });
        expect(intent.markModified).toHaveBeenCalledWith('metadata');
    });

    test('getLockUntilDate and assertConfirmNotLocked honor valid future locks only', () => {
        const future = new Date(Date.now() + 45_000).toISOString();
        const expired = new Date(Date.now() - 45_000).toISOString();

        expect(getLockUntilDate({ metadata: { securityLayer: { lockedUntil: 'bad-date' } } })).toBeNull();
        expect(getLockUntilDate({ metadata: { securityLayer: { lockedUntil: expired } } })).toBeInstanceOf(Date);
        expect(() => assertConfirmNotLocked({ metadata: { securityLayer: { lockedUntil: expired } } })).not.toThrow();
        expect(() => assertConfirmNotLocked({ metadata: { securityLayer: { lockedUntil: future } } }))
            .toThrow(/Payment confirmation temporarily locked/);
    });

    test('quote and expiry guards detect mismatch and expired intents', () => {
        expect(diff(10, 9.98)).toBeCloseTo(0.02, 5);
        expect(() => assertQuoteMatches({ totalPrice: 100 }, 100.005)).not.toThrow();
        expect(() => assertQuoteMatches({ totalPrice: 100 }, 101))
            .toThrow('Quote expired. Please recalculate before payment.');
        expect(() => assertQuoteMatches(null, 101)).not.toThrow();

        expect(Boolean(isIntentExpired({ expiresAt: new Date(Date.now() - 1_000).toISOString() }))).toBe(true);
        expect(Boolean(isIntentExpired({ expiresAt: new Date(Date.now() + 60_000).toISOString() }))).toBe(false);
    });
});
