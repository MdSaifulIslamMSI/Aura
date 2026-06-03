const {
    readTrafficResiliencePolicy,
    validateTrafficResiliencePolicy,
} = require('../config/trafficResiliencePolicy');
const {
    ROUTE_CLASSES,
    classifyRoute,
    getTrafficBudget,
} = require('../config/trafficBudgets');

describe('traffic resilience policy', () => {
    test('policy file validates every configured category', () => {
        const policy = readTrafficResiliencePolicy();
        const result = validateTrafficResiliencePolicy(policy);

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(Object.keys(policy.categories)).toEqual(expect.arrayContaining([
            'loginAttempts',
            'otpRequests',
            'paymentIntents',
            'aiRequests',
            'uploadWrites',
            'adminSensitiveActions',
            'webhookEvents',
            'searchRequests',
        ]));
    });

    test('dangerous route families classify into bounded budgets', () => {
        expect(classifyRoute({ method: 'POST', path: '/api/auth/login' })).toBe(ROUTE_CLASSES.AUTH_LOGIN);
        expect(classifyRoute({ method: 'POST', path: '/api/otp/send' })).toBe(ROUTE_CLASSES.OTP);
        expect(classifyRoute({ method: 'POST', path: '/api/payments/create-order' })).toBe(ROUTE_CLASSES.PAYMENT);
        expect(classifyRoute({ method: 'POST', path: '/api/ai/chat' })).toBe(ROUTE_CLASSES.AI_EXPENSIVE);
        expect(classifyRoute({ method: 'POST', path: '/api/uploads/review' })).toBe(ROUTE_CLASSES.UPLOAD);
        expect(classifyRoute({ method: 'POST', path: '/api/payments/webhooks/stripe' })).toBe(ROUTE_CLASSES.WEBHOOK);
    });

    test('sensitive budgets fail closed or stay non-degradable where expected', () => {
        const payment = getTrafficBudget(ROUTE_CLASSES.PAYMENT);
        const ai = getTrafficBudget(ROUTE_CLASSES.AI_EXPENSIVE);
        const webhook = getTrafficBudget(ROUTE_CLASSES.WEBHOOK);

        expect(payment.costRisk).toBe('critical');
        expect(payment.productionFailMode).toBe('fail-closed');
        expect(payment.canDegrade).toBe(false);
        expect(ai.emergencyFlag).toBe('ATTACK_MODE_BLOCK_AI');
        expect(webhook.canDegrade).toBe(false);
    });
});
