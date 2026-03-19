const request = require('supertest');

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

describe('Email Webhook Routes', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        process.env = {
            ...ORIGINAL_ENV,
            NODE_ENV: 'test',
            RESEND_WEBHOOK_SECRET: 'whsec_test_secret',
        };
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    test('POST /api/email-webhooks/resend accepts verified resend webhooks', async () => {
        const app = require('../index');
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
