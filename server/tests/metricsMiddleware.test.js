const EventEmitter = require('events');
const {
    metricsMiddleware,
    registry,
} = require('../middleware/metrics');

describe('metricsMiddleware', () => {
    beforeEach(() => {
        registry.resetMetrics();
    });

    test('falls back to the request path when Express route metadata is not a string', async () => {
        const req = {
            method: 'GET',
            path: '/uploads/avatars/550e8400-e29b-41d4-a716-446655440000',
            route: { path: { wildcard: true } },
        };
        const res = new EventEmitter();
        res.statusCode = 200;
        const next = jest.fn();

        metricsMiddleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(() => res.emit('finish')).not.toThrow();

        const metric = await registry.getSingleMetric('aura_http_requests_total').get();
        expect(metric.values).toEqual(expect.arrayContaining([
            expect.objectContaining({
                labels: {
                    method: 'GET',
                    route: '/uploads/avatars/:uuid',
                    status_code: '200',
                },
                value: 1,
            }),
        ]));
    });
});
