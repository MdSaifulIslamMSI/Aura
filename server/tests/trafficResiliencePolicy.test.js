const fs = require('fs');
const path = require('path');
const {
    TRAFFIC_RESILIENCE_POLICY_PATH,
    getTrafficResiliencePolicyPathCandidates,
    readTrafficResiliencePolicy,
    resolveTrafficResiliencePolicyPath,
    validateTrafficResiliencePolicy,
} = require('../config/trafficResiliencePolicy');
const {
    ROUTE_CLASSES,
    classifyRoute,
    getTrafficBudget,
} = require('../config/trafficBudgets');

describe('traffic resilience policy', () => {
    test('runtime resolver supports source and packaged server layouts', () => {
        const repoRootPolicy = path.resolve(__dirname, '..', '..', 'config', 'security', 'traffic-resilience-policy.json');
        const packagedServerPolicy = path.resolve(__dirname, '..', 'config', 'security', 'traffic-resilience-policy.json');
        const pathCandidates = getTrafficResiliencePolicyPathCandidates();

        expect(TRAFFIC_RESILIENCE_POLICY_PATH).toBe(repoRootPolicy);
        expect(pathCandidates).toEqual(expect.arrayContaining([
            repoRootPolicy,
            packagedServerPolicy,
        ]));
    });

    test('packaged server policy stays in sync with root policy', () => {
        const repoRootPolicy = path.resolve(__dirname, '..', '..', 'config', 'security', 'traffic-resilience-policy.json');
        const packagedServerPolicy = path.resolve(__dirname, '..', 'config', 'security', 'traffic-resilience-policy.json');

        expect(JSON.parse(fs.readFileSync(packagedServerPolicy, 'utf8'))).toEqual(
            JSON.parse(fs.readFileSync(repoRootPolicy, 'utf8')),
        );
    });

    test('runtime resolver falls back to packaged server policy when root policy is absent', () => {
        const repoRootPolicy = '/app-missing/config/security/traffic-resilience-policy.json';
        const packagedServerPolicy = '/app/config/security/traffic-resilience-policy.json';

        expect(resolveTrafficResiliencePolicyPath(
            [repoRootPolicy, packagedServerPolicy],
            (candidate) => candidate === packagedServerPolicy,
        )).toBe(packagedServerPolicy);
    });

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
        expect(classifyRoute({ method: 'POST', path: '/api/auth/otp/reset-password' })).toBe(ROUTE_CLASSES.OTP_RESET);
        expect(classifyRoute({ method: 'POST', path: '/api/payments/create-order' })).toBe(ROUTE_CLASSES.PAYMENT);
        expect(classifyRoute({ method: 'POST', path: '/api/ai/chat' })).toBe(ROUTE_CLASSES.AI_EXPENSIVE);
        expect(classifyRoute({ method: 'POST', path: '/api/uploads/review' })).toBe(ROUTE_CLASSES.UPLOAD);
        expect(classifyRoute({ method: 'POST', path: '/api/payments/webhooks/stripe' })).toBe(ROUTE_CLASSES.WEBHOOK);
    });

    test('sensitive budgets fail closed or stay non-degradable where expected', () => {
        const payment = getTrafficBudget(ROUTE_CLASSES.PAYMENT);
        const otpReset = getTrafficBudget(ROUTE_CLASSES.OTP_RESET);
        const ai = getTrafficBudget(ROUTE_CLASSES.AI_EXPENSIVE);
        const webhook = getTrafficBudget(ROUTE_CLASSES.WEBHOOK);

        expect(payment.costRisk).toBe('critical');
        expect(payment.productionFailMode).toBe('fail-closed');
        expect(payment.canDegrade).toBe(false);
        expect(otpReset.costRisk).toBe('critical');
        expect(otpReset.productionFailMode).toBe('fail-closed');
        expect(otpReset.canDegrade).toBe(false);
        expect(otpReset.timeoutMs).toBeGreaterThan(getTrafficBudget(ROUTE_CLASSES.OTP).timeoutMs);
        expect(ai.emergencyFlag).toBe('ATTACK_MODE_BLOCK_AI');
        expect(webhook.canDegrade).toBe(false);
    });
});
