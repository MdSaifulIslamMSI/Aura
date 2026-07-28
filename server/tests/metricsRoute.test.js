const express = require('express');
const request = require('supertest');

jest.mock('../middleware/metrics', () => ({
    metricsAuth: (req, res, next) => next(),
    registry: {
        contentType: 'text/plain; version=0.0.4; charset=utf-8',
        getMetricsAsArray: jest.fn(),
        getMetricsAsString: jest.fn(),
        metrics: jest.fn(),
    },
}));

jest.mock('../services/accountProductTelemetryService', () => ({
    refreshAccountMigrationMetrics: jest.fn(),
}));

const { registry } = require('../middleware/metrics');
const { refreshAccountMigrationMetrics } = require('../services/accountProductTelemetryService');
const metricsRoute = require('../routes/metricsRoute');

describe('metricsRoute', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        refreshAccountMigrationMetrics.mockResolvedValue(true);
    });

    test('streams metric families sequentially without building the full registry payload', async () => {
        const metricFamilies = [
            { name: 'aura_first' },
            { name: 'aura_second' },
            { name: 'aura_third' },
        ];
        let activeRenders = 0;
        let maxActiveRenders = 0;

        registry.getMetricsAsArray.mockReturnValue(metricFamilies);
        registry.getMetricsAsString.mockImplementation(async ({ name }) => {
            activeRenders += 1;
            maxActiveRenders = Math.max(maxActiveRenders, activeRenders);
            await Promise.resolve();
            activeRenders -= 1;
            return `# HELP ${name} bounded\n# TYPE ${name} gauge\n${name} 1`;
        });
        registry.metrics.mockImplementation(() => {
            throw new Error('full registry rendering must not be used');
        });

        const app = express();
        app.use('/metrics', metricsRoute);

        const response = await request(app).get('/metrics').expect(200);

        expect(response.headers['content-type']).toContain('text/plain');
        expect(response.text).toBe(
            '# HELP aura_first bounded\n# TYPE aura_first gauge\naura_first 1'
            + '\n\n# HELP aura_second bounded\n# TYPE aura_second gauge\naura_second 1'
            + '\n\n# HELP aura_third bounded\n# TYPE aura_third gauge\naura_third 1\n'
        );
        expect(refreshAccountMigrationMetrics).toHaveBeenCalledTimes(1);
        expect(registry.getMetricsAsString).toHaveBeenCalledTimes(3);
        expect(registry.metrics).not.toHaveBeenCalled();
        expect(maxActiveRenders).toBe(1);
    });
});
