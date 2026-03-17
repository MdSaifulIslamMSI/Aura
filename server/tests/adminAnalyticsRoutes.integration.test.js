jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = {
            _id: '69aa0000000000000000admin',
            email: 'admin@example.com',
            isAdmin: true,
        };
        req.authToken = {
            email_verified: true,
            auth_time: Math.floor(Date.now() / 1000),
        };
        return next();
    },
    admin: (req, res, next) => next(),
}));

jest.mock('../services/adminAnalyticsService', () => ({
    getOverviewMetrics: jest.fn(),
    getTimeSeriesMetrics: jest.fn(),
    detectAnomalies: jest.fn(),
    getCsvExport: jest.fn(),
    getBiConfig: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const adminAnalyticsRoutes = require('../routes/adminAnalyticsRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const {
    getOverviewMetrics,
    getTimeSeriesMetrics,
    detectAnomalies,
    getCsvExport,
    getBiConfig,
} = require('../services/adminAnalyticsService');

const buildTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/analytics', adminAnalyticsRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Admin analytics routes integration', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildTestApp();

        getOverviewMetrics.mockResolvedValue({
            range: { rangeKey: '30d' },
            overview: {
                orders: { total: 42 },
            },
        });
        getTimeSeriesMetrics.mockResolvedValue({
            series: [{ bucket: '2026-03-01', orders: 5 }],
            meta: { granularity: 'day' },
        });
        detectAnomalies.mockResolvedValue({
            anomalies: [{ id: 'an_1', severity: 'warning' }],
        });
        getCsvExport.mockResolvedValue({
            filename: 'admin-analytics.csv',
            rowCount: 2,
            csv: 'bucket,orders\n2026-03-01,5\n',
        });
        getBiConfig.mockReturnValue({
            enabled: true,
            provider: 'native',
        });
    });

    test('GET /api/admin/analytics/overview returns overview metrics through the real route', async () => {
        const res = await request(app).get('/api/admin/analytics/overview?range=7d');

        expect(res.statusCode).toBe(200);
        expect(getOverviewMetrics).toHaveBeenCalledWith(expect.objectContaining({ range: '7d' }));
        expect(res.body).toMatchObject({
            success: true,
            overview: {
                orders: { total: 42 },
            },
        });
    });

    test('GET /api/admin/analytics/timeseries enforces query validation', async () => {
        const res = await request(app).get('/api/admin/analytics/timeseries?granularity=minute');

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Validation Error');
    });

    test('GET /api/admin/analytics/anomalies returns anomaly payload through the real route', async () => {
        const res = await request(app).get('/api/admin/analytics/anomalies?windowMinutes=60');

        expect(res.statusCode).toBe(200);
        expect(detectAnomalies).toHaveBeenCalledWith(expect.objectContaining({ windowMinutes: '60' }));
        expect(res.body).toMatchObject({
            success: true,
            anomalies: [{ id: 'an_1', severity: 'warning' }],
        });
    });

    test('GET /api/admin/analytics/export streams CSV with export headers', async () => {
        const res = await request(app).get('/api/admin/analytics/export?dataset=orders&limit=50');

        expect(res.statusCode).toBe(200);
        expect(getCsvExport).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'orders', limit: '50' }));
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('admin-analytics.csv');
        expect(res.headers['x-admin-export-row-count']).toBe('2');
        expect(res.text).toContain('bucket,orders');
    });

    test('GET /api/admin/analytics/export rejects invalid custom dates with a clean 400 error', async () => {
        const res = await request(app).get('/api/admin/analytics/export?range=custom&from=not-a-date&to=still-not-a-date');

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Custom range requires valid from and to parameters');
        expect(getCsvExport).not.toHaveBeenCalled();
    });

    test('GET /api/admin/analytics/bi-config returns BI config through the real route', async () => {
        const res = await request(app).get('/api/admin/analytics/bi-config');

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            config: {
                enabled: true,
                provider: 'native',
            },
        });
    });
});
