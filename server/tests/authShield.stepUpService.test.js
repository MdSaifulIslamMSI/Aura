const {
    hasFreshAuthTime,
    recordStepUpSuccess,
    requireStepUp,
    resetStepUpMemoryForTests,
} = require('../security/authShield/stepUpService');

describe('authShield step-up service', () => {
    const config = {
        stepUpEnabled: true,
        stepUpTtlCriticalSeconds: 300,
        stepUpTtlHighSeconds: 900,
    };

    afterEach(() => resetStepUpMemoryForTests());

    test('critical actions accept fresh auth within five minutes', () => {
        const now = Math.floor(Date.now() / 1000);
        expect(hasFreshAuthTime({ authToken: { auth_time: now - 60 } }, 'critical', config)).toBe(true);
        expect(hasFreshAuthTime({ authToken: { auth_time: now - 600 } }, 'critical', config)).toBe(false);
    });

    test('step-up is bound by session user and action family', async () => {
        const req = {
            user: { _id: 'u1' },
            authSession: { sessionId: 's1', userId: 'u1' },
        };
        await recordStepUpSuccess(req, 'payment.refund', 'critical', config);

        const refund = await requireStepUp(req, 'payment.refund', 'critical', {
            config,
            actionPolicy: { stepUp: true },
        });
        const admin = await requireStepUp(req, 'admin.config.update', 'critical', {
            config,
            actionPolicy: { stepUp: true },
        });

        expect(refund.fresh).toBe(true);
        expect(admin.fresh).toBe(false);
    });
});
