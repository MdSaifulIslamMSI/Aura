const {
    authShield,
    buildReq,
    shieldEnv,
    withAuthShieldEnv,
} = require('./helpers/authShieldTestHelpers');

describe('authShield admin route integration', () => {
    test('user role change requires critical step-up', async () => {
        await withAuthShieldEnv(shieldEnv({ stepUp: 'true' }), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'admin-1',
                isAdmin: true,
                roles: ['admin'],
                authAgeSeconds: 600,
                path: '/api/admin/users/user-2/suspend',
            }), {
                action: 'admin.user.role.update',
                sensitivity: 'critical',
                resource: { type: 'user', id: 'user-2', ownerId: 'user-2' },
                requireFreshAuth: true,
            });

            expect(decision.decision).toBe('step_up_required');
            expect(decision.enforced).toBe(true);
        });
    });

    test('fail-closed admin action blocks even in shadow mode', async () => {
        await withAuthShieldEnv(shieldEnv({ shadow: 'true' }), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'user-1',
                roles: ['user'],
                path: '/api/admin/ops/maintenance',
            }), {
                action: 'admin.config.update',
                sensitivity: 'critical',
                resource: { type: 'admin_config', id: 'maintenance' },
            });

            expect(decision.decision).toBe('deny');
            expect(decision.enforced).toBe(true);
        });
    });
});
