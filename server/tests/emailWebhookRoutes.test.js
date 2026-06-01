const request = require('supertest');
const express = require('express');

jest.mock('svix', () => ({
    Webhook: jest.fn().mockImplementation(() => ({
        verify: jest.fn().mockReturnValue({
            type: 'email.delivered',
            data: {
                email_id: 'msg_123',
                to: ['ops@example.com'],
                subject: 'Delivered',
                tags: [{ name: 'admin-test' }],
            },
            created_at: '2026-03-19T09:30:00.000Z',
        }),
    })),
}));

jest.mock('../services/email/emailDeliveryAuditService', () => ({
    recordEmailWebhookEvent: jest.fn().mockResolvedValue({ skipped: false }),
}));

const createEmailWebhookApp = () => {
    const { errorHandler } = require('../middleware/errorMiddleware');
    const emailWebhookRoutes = require('../routes/emailWebhookRoutes');
    const app = express();

    app.use(express.json({
        verify: (req, _res, buf) => {
            req.rawBody = buf.toString('utf8');
        },
    }));
    app.use('/api/email-webhooks', emailWebhookRoutes);
    app.use(errorHandler);
    return app;
};

describe('Email Webhook Routes', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        process.env = {
            ...ORIGINAL_ENV,
            NODE_ENV: 'test',
        };
        process.env.RESEND_WEBHOOK_SECRET = 'resend-webhook-signing-key-for-jest';
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    test('POST /api/email-webhooks/resend accepts verified resend webhooks', async () => {
        process.env.RESEND_WEBHOOK_SECRET = 'resend-webhook-signing-key-for-jest';
        const app = createEmailWebhookApp();
        const res = await request(app)
            .post('/api/email-webhooks/resend')
            .set('svix-id', 'msg_test_123')
            .set('svix-timestamp', '1711111111')
            .set('svix-signature', 'v1,test')
            .send({ hello: 'world' });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
