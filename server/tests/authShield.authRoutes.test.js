const {
    authShield,
    buildReq,
    shieldEnv,
    withAuthShieldEnv,
} = require('./helpers/authShieldTestHelpers');

describe('authShield auth route integration', () => {
    test('MFA disable requires critical step-up', async () => {
        await withAuthShieldEnv(shieldEnv({ stepUp: 'true' }), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'user-1',
                authAgeSeconds: 900,
                path: '/api/auth/mfa/totp/disable',
            }), {
                action: 'auth.mfa.disable',
                sensitivity: 'critical',
                resource: { type: 'auth', id: 'user-1', ownerId: 'user-1' },
                requireFreshAuth: true,
            });

            expect(decision.decision).toBe('step_up_required');
        });
    });

    test('missing DPoP proof is shadow logged when DPoP is disabled', async () => {
        await withAuthShieldEnv(shieldEnv({ enabled: 'true', shadow: 'false', dpop: 'false' }), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'seller-1',
                isSeller: true,
                path: '/api/listings/listing-1',
            }), {
                action: 'listing.update',
                sensitivity: 'medium',
                resource: { type: 'listing', id: 'listing-1', ownerId: 'seller-1', sellerId: 'seller-1' },
            });

            expect(decision.decision).toBe('allow');
            expect(decision.reasons).toContain('dpop_disabled_missing_proof');
        });
    });
});
