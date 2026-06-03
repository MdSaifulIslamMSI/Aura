const EventEmitter = require('events');

const ORIGINAL_ENV = { ...process.env };

const buildResponse = () => {
    const res = new EventEmitter();
    res.headersSent = false;
    res.statusCode = 200;
    res.set = jest.fn();
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
    return res;
};

describe('trafficBudgetPolicy middleware', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('creates per-dimension distributed limiters from route budgets', async () => {
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

        const { trafficBudgetPolicy } = require('../middleware/trafficBudgetPolicy');
        const next = jest.fn();
        const req = {
            method: 'GET',
            headers: { 'x-client-session-id': 'session-1' },
            ip: '198.51.100.24',
            trafficBudget: {
                routeClass: 'PUBLIC_SEARCH',
                perIp: 10,
                perAccount: 0,
                perSession: 5,
                windowSeconds: 60,
                productionFailMode: 'fail-open-safe',
                costRisk: 'medium',
                userMessageCode: 'QUERY_BUDGET_EXCEEDED',
            },
        };

        await trafficBudgetPolicy()(req, buildResponse(), next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(created.map((entry) => entry.name)).toEqual([
            'traffic_perIp_public_search',
            'traffic_perSession_public_search',
        ]);
        expect(created[0]).toMatchObject({
            allowInMemoryFallback: true,
            max: 10,
            windowMs: 60000,
        });
    });

    test('resolves when an inner limiter terminates the response', async () => {
        jest.doMock('../middleware/distributedRateLimit', () => ({
            createDistributedRateLimit: jest.fn(() => (_req, res) => res.status(429).json({ code: 'TRAFFIC_BUDGET_DENIED' })),
        }));
        const recordTrafficBudgetDenied = jest.fn();
        jest.doMock('../metrics/trafficResilienceMetrics', () => ({
            recordTrafficBudgetDenied,
        }));

        const { trafficBudgetPolicy } = require('../middleware/trafficBudgetPolicy');
        const next = jest.fn();
        const res = buildResponse();

        await trafficBudgetPolicy()({
            method: 'GET',
            headers: {},
            ip: '198.51.100.24',
            trafficBudget: {
                routeClass: 'PUBLIC_SEARCH',
                perIp: 1,
                perAccount: 0,
                perSession: 0,
                windowSeconds: 60,
                productionFailMode: 'fail-open-safe',
                costRisk: 'medium',
                userMessageCode: 'QUERY_BUDGET_EXCEEDED',
            },
        }, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(429);
        expect(recordTrafficBudgetDenied).toHaveBeenCalledWith({
            routeClass: 'PUBLIC_SEARCH',
            reason: 'rate_limit',
        });
    });
});
