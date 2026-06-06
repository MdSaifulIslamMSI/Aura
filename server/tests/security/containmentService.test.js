const {
    __resetContainmentState,
    applyContainment,
    getContainmentState,
    isActionContained,
} = require('../../security/containmentService');

describe('containmentService', () => {
    beforeEach(() => {
        __resetContainmentState();
    });

    test('records containment actions for a user', () => {
        const state = applyContainment({
            context: { userId: 'user-1', action: 'data.export' },
            decision: {
                riskScore: 95,
                reason: 'data_export_anomaly',
                containmentActions: ['freeze_exports', 'require_step_up'],
            },
        });

        expect(state.actions).toEqual(expect.arrayContaining(['freeze_exports', 'require_step_up']));
        expect(getContainmentState({ userId: 'user-1' })).toMatchObject({ incidents: 1 });
        expect(isActionContained({ userId: 'user-1' }, 'freeze_exports')).toBe(true);
    });

    test('marks request session revoked when requested', () => {
        const req = { authSession: {} };
        applyContainment({
            req,
            context: { userId: 'user-1', action: 'auth.password.change' },
            decision: {
                riskScore: 90,
                reason: 'session_compromised',
                containmentActions: ['revoke_session'],
            },
        });

        expect(req.authSession.revoked).toBe(true);
    });
});
