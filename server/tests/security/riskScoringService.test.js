const {
    computeRiskScore,
    riskLevelForScore,
} = require('../../security/riskScoringService');

describe('riskScoringService', () => {
    test('scores low-risk trusted requests low', () => {
        const result = computeRiskScore({
            deviceTrust: 'trusted',
            requestVelocity: 0,
            failedAttemptCount: 0,
            previousSecurityEvents: 0,
            payloadRisk: 0,
            ipHash: 'ip',
            userAgentHash: 'ua',
        }, { sensitivity: 'low', requiresAuth: false });

        expect(result.riskScore).toBe(0);
        expect(result.level).toBe('low');
    });

    test('scores repeated failures and velocity as high risk', () => {
        const result = computeRiskScore({
            deviceTrust: 'untrusted',
            requestVelocity: 25,
            failedAttemptCount: 6,
            previousSecurityEvents: 2,
            payloadRisk: 40,
        }, { sensitivity: 'critical', requiresAuth: true, requiresFreshAuth: true });

        expect(result.riskScore).toBeGreaterThanOrEqual(65);
        expect(result.reasons).toEqual(expect.arrayContaining([
            'device_untrusted',
            'request_velocity_high',
            'failed_attempts_high',
        ]));
    });

    test('risk level thresholds are stable', () => {
        expect(riskLevelForScore(10)).toBe('low');
        expect(riskLevelForScore(35)).toBe('medium');
        expect(riskLevelForScore(65)).toBe('high');
        expect(riskLevelForScore(85)).toBe('critical');
    });
});
