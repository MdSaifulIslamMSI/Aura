jest.mock('../config/trafficBudgets', () => ({
    getTrafficBudget: jest.fn(),
    normalizeRoutePath: jest.fn(),
}));

jest.mock('../config/trafficPolicyRegistry', () => ({
    getTrafficPolicyForRoute: jest.fn(),
}));

const { getTrafficBudget, normalizeRoutePath } = require('../config/trafficBudgets');
const { getTrafficPolicyForRoute } = require('../config/trafficPolicyRegistry');
const { routeCostClassifier } = require('../middleware/routeCostClassifier');

describe('routeCostClassifier middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('stamps the traffic policy, class, budget, and normalized path on the request', () => {
        const policy = { routeClass: 'catalog_read' };
        const budget = { capacity: 100 };
        getTrafficPolicyForRoute.mockReturnValue(policy);
        getTrafficBudget.mockReturnValue(budget);
        normalizeRoutePath.mockReturnValue('/api/products');

        const req = { method: 'GET', path: '/api/products/123?x=1', originalUrl: '/api/products/123?x=1' };
        const next = jest.fn();

        routeCostClassifier(req, {}, next);

        expect(getTrafficPolicyForRoute).toHaveBeenCalledWith({
            method: 'GET',
            path: '/api/products/123?x=1',
            originalUrl: '/api/products/123?x=1',
        });
        expect(req.trafficPolicy).toBe(policy);
        expect(req.trafficRouteClass).toBe('catalog_read');
        expect(req.trafficBudget).toBe(budget);
        expect(req.trafficNormalizedPath).toBe('/api/products');
        expect(next).toHaveBeenCalledTimes(1);
    });

    test('normalizes the bare path when req.path is missing', () => {
        getTrafficPolicyForRoute.mockReturnValue({ routeClass: 'default' });
        normalizeRoutePath.mockReturnValue('/');

        const req = { method: 'GET', originalUrl: '/' };
        routeCostClassifier(req, {}, jest.fn());

        expect(normalizeRoutePath).toHaveBeenCalledWith('/');
    });
});
