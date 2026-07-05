const EventEmitter = require('events');

const ORIGINAL_ENV = { ...process.env };

const expectedComponents = [
    'Auth/login/session',
    'OTP send',
    'Password reset',
    'MFA/passkey/Duo step-up',
    'Admin routes',
    'Payment/checkout/order',
    'Cart',
    'Product browsing',
    'Search/listing/marketplace',
    'Upload/review media',
    'AI assistant/chat/model gateway',
    'Recommendation events',
    'Email/SMS/webhooks',
    'LiveKit/socket/video support',
    'i18n/translation',
    'Observability/health',
    'Static frontend/assets',
    'Internal jobs/workers',
];

const buildResponse = () => {
    const res = new EventEmitter();
    res.headersSent = false;
    res.status = jest.fn((code) => {
        res.statusCode = code;
        return res;
    });
    res.json = jest.fn((payload) => {
        res.body = payload;
        res.headersSent = true;
        res.emit('finish');
        return res;
    });
    res.set = jest.fn();
    res.setHeader = jest.fn();
    return res;
};

describe('traffic policy registry', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('every registered component has policy coverage', () => {
        const { listTrafficComponents, listTrafficPolicies } = require('../config/trafficPolicyRegistry');
        const components = listTrafficComponents();

        expect(components).toEqual(expect.arrayContaining(expectedComponents));
        for (const component of expectedComponents) {
            expect(listTrafficPolicies().some((policy) => policy.componentName === component)).toBe(true);
        }
    });

    test('route examples classify into expected smooth or strict profiles', () => {
        const { PROFILES, getTrafficPolicyForRoute } = require('../config/trafficPolicyRegistry');

        expect(getTrafficPolicyForRoute({ method: 'GET', path: '/api/products?limit=24' })).toMatchObject({
            profile: PROFILES.PUBLIC_BROWSING,
            routeClass: 'PUBLIC_SEARCH',
        });
        expect(getTrafficPolicyForRoute({ method: 'POST', path: '/api/auth/verify-device' })).toMatchObject({
            profile: PROFILES.AUTH_SECURITY,
            routeClass: 'AUTH_WEBAUTHN',
            flowProtectionRequired: true,
        });
        expect(getTrafficPolicyForRoute({ method: 'POST', path: '/api/otp/send' })).toMatchObject({
            routeClass: 'OTP',
            failMode: 'fail-closed',
        });
        expect(getTrafficPolicyForRoute({ method: 'POST', path: '/api/otp/reset-password' })).toMatchObject({
            routeClass: 'OTP_RESET',
            flowProtectionRequired: true,
        });
    });

    test('high-risk component policies keep merge-blocking guard posture', () => {
        const { getTrafficPolicyForRoute } = require('../config/trafficPolicyRegistry');

        expect(getTrafficPolicyForRoute({ method: 'POST', path: '/api/admin/users/user-1/suspend' })).toMatchObject({
            adminRequired: true,
            failMode: 'fail-closed',
            routeClass: 'ADMIN_WRITE',
        });
        expect(getTrafficPolicyForRoute({ method: 'POST', path: '/api/payments/intents' })).toMatchObject({
            idempotencyRequired: true,
            routeClass: 'PAYMENT',
        });
        expect(getTrafficPolicyForRoute({ method: 'POST', path: '/api/uploads/reviews/upload' })).toMatchObject({
            fileValidationRequired: true,
            bodySizeBytes: expect.any(Number),
        });
        expect(getTrafficPolicyForRoute({ method: 'POST', path: '/api/ai/chat' })).toMatchObject({
            quotaRequired: true,
            concurrencyCapRequired: true,
            routeClass: 'AI_EXPENSIVE',
        });
        expect(getTrafficPolicyForRoute({ method: 'GET', path: '/health/live' })).toMatchObject({
            routeClass: 'HEALTH',
            timeoutMs: 1500,
        });
    });

    test('critical production traffic budgets do not allow in-memory fail-open fallback', async () => {
        process.env.NODE_ENV = 'production';
        const created = [];
        jest.doMock('../middleware/distributedRateLimit', () => ({
            createDistributedRateLimit: jest.fn((options) => {
                created.push(options);
                return (_req, _res, next) => next();
            }),
        }));
        jest.doMock('../metrics/trafficResilienceMetrics', () => ({
            recordTrafficBudgetDenied: jest.fn(),
        }));

        const { ROUTE_CLASSES, getTrafficBudget } = require('../config/trafficBudgets');
        const { trafficBudgetPolicy } = require('../middleware/trafficBudgetPolicy');
        await trafficBudgetPolicy()({
            method: 'POST',
            headers: {},
            ip: '203.0.113.10',
            trafficBudget: getTrafficBudget(ROUTE_CLASSES.PAYMENT),
        }, buildResponse(), jest.fn());

        expect(created.length).toBeGreaterThan(0);
        expect(created.every((options) => options.securityCritical)).toBe(true);
        expect(created.every((options) => options.allowInMemoryFallback === false)).toBe(true);
    });

    test('development and testability remain intact for public read budgets', async () => {
        process.env.NODE_ENV = 'development';
        const created = [];
        jest.doMock('../middleware/distributedRateLimit', () => ({
            createDistributedRateLimit: jest.fn((options) => {
                created.push(options);
                return (_req, _res, next) => next();
            }),
        }));
        jest.doMock('../metrics/trafficResilienceMetrics', () => ({
            recordTrafficBudgetDenied: jest.fn(),
        }));

        const { ROUTE_CLASSES, getTrafficBudget } = require('../config/trafficBudgets');
        const { trafficBudgetPolicy } = require('../middleware/trafficBudgetPolicy');
        await trafficBudgetPolicy()({
            method: 'GET',
            headers: {},
            ip: '203.0.113.10',
            trafficBudget: getTrafficBudget(ROUTE_CLASSES.PUBLIC_SEARCH),
        }, buildResponse(), jest.fn());

        expect(created.length).toBeGreaterThan(0);
        expect(created.every((options) => options.allowInMemoryFallback)).toBe(true);
    });
});
