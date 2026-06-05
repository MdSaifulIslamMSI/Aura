const {
    authShield,
    buildReq,
    shieldEnv,
    withAuthShieldEnv,
} = require('./helpers/authShieldTestHelpers');

describe('authShield payment route integration', () => {
    test('payment refund requires step-up when stale', async () => {
        await withAuthShieldEnv(shieldEnv({ stepUp: 'true' }), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'buyer-1',
                authAgeSeconds: 600,
                path: '/api/payments/intents/pi_1/refunds',
            }), {
                action: 'payment.refund',
                sensitivity: 'critical',
                resource: { type: 'refund', id: 'pi_1', ownerId: 'buyer-1', buyerId: 'buyer-1' },
                requireFreshAuth: true,
                requireDeviceProof: true,
            });

            expect(decision.decision).toBe('step_up_required');
        });
    });

    test('bad DPoP proof is denied when enabled', async () => {
        await withAuthShieldEnv(shieldEnv({ dpop: 'true', replay: 'true' }), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'buyer-1',
                path: '/api/payments/intents/pi_1/refunds',
                headers: { dpop: 'bad.proof.value' },
            }), {
                action: 'payment.refund',
                sensitivity: 'critical',
                resource: { type: 'refund', id: 'pi_1', ownerId: 'buyer-1', buyerId: 'buyer-1' },
            });

            expect(decision.decision).toBe('deny');
            expect(decision.reasons.join(' ')).toMatch(/dpop|DPoP|proof/i);
        });
    });

    test('X-Aura-Request-Proof is accepted as a proof header when DPoP is enabled', async () => {
        await withAuthShieldEnv(shieldEnv({ dpop: 'true', replay: 'true' }), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'buyer-1',
                path: '/api/payments/intents/pi_1/refunds',
                headers: { 'x-aura-request-proof': 'bad.proof.value' },
            }), {
                action: 'payment.refund',
                sensitivity: 'critical',
                resource: { type: 'refund', id: 'pi_1', ownerId: 'buyer-1', buyerId: 'buyer-1' },
            });

            expect(decision.decision).toBe('deny');
            expect(decision.reasons).not.toContain('DPoP header is required');
            expect(decision.reasons.join(' ')).toMatch(/dpop|DPoP|decode|proof/i);
        });
    });
});
