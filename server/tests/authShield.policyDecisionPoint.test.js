const { decide } = require('../security/authShield/policyDecisionPoint');

describe('authShield policy decision point', () => {
    test('missing identity is denied', () => {
        const result = decide({
            identityResult: { reasons: ['identity_missing'], identity: {} },
            relationship: { allowed: true },
            replay: { ok: true },
            dpop: { ok: true },
            device: { ok: true },
            risk: { level: 'low' },
            stepUp: { enabled: false, fresh: true },
            action: 'listing.update',
            sensitivity: 'medium',
        });

        expect(result.decision).toBe('deny');
    });

    test('critical stale step-up returns step_up_required before allow', () => {
        const result = decide({
            identityResult: {
                reasons: [],
                identity: { userId: 'admin-1', hasAdminRole: true, roles: ['admin'] },
            },
            relationship: { allowed: true },
            replay: { ok: true },
            dpop: { ok: true },
            device: { ok: true },
            risk: { level: 'low' },
            stepUp: { requiredByPolicy: true, enabled: true, fresh: false },
            action: 'admin.user.role.update',
            sensitivity: 'critical',
        });

        expect(result.decision).toBe('step_up_required');
    });
});
