jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    warn: jest.fn(),
}));

jest.mock('../models/EmailDeliveryLog', () => ({
    create: jest.fn(),
    findOne: jest.fn(),
}));

const EmailDeliveryLog = require('../models/EmailDeliveryLog');
const {
    persistEmailDeliveryLog,
    recordEmailWebhookEvent,
} = require('../services/email/emailDeliveryAuditService');

describe('emailDeliveryAuditService', () => {
    beforeEach(() => {
        EmailDeliveryLog.create.mockReset().mockImplementation(async (payload) => ({
            ...payload,
            toObject: () => payload,
        }));
        EmailDeliveryLog.findOne.mockReset().mockResolvedValue(null);
    });

    test('redacts provider tokens from delivery response and metadata summaries', async () => {
        const bearer = ['Bearer ', 'emaildeliverytoken'].join('');

        await persistEmailDeliveryLog({
            eventType: 'activity',
            status: 'failed',
            provider: 'smtp',
            requestId: 'req-email-audit-redaction',
            subject: `Reset link ${bearer}`,
            errorMessage: `provider rejected ${bearer}`,
            responseSummary: {
                response: `upstream said ${bearer}`,
            },
            metaSummary: {
                authorization: bearer,
                callback: '/auth/callback?code=raw-code&ok=1',
                safe: 'kept',
            },
        });

        const created = EmailDeliveryLog.create.mock.calls[0][0];
        const serialized = JSON.stringify(created);

        expect(created.subject).toBe('Reset link [REDACTED]');
        expect(created.errorMessage).toBe('provider rejected [REDACTED]');
        expect(created.responseSummary.response).toBe('upstream said [REDACTED]');
        expect(created.metaSummary.authorization).toBe('[REDACTED]');
        expect(created.metaSummary.callback).toContain('code=[REDACTED]');
        expect(created.metaSummary.safe).toBe('kept');
        expect(serialized).not.toContain('emaildeliverytoken');
        expect(serialized).not.toContain('raw-code');
    });

    test('redacts tokenized click links from webhook event summaries', async () => {
        await recordEmailWebhookEvent({
            provider: 'resend',
            webhookEventId: 'evt-email-audit-redaction',
            webhookType: 'email.clicked',
            providerMessageId: 'msg-email-audit-redaction',
            recipientEmail: 'recipient@example.test',
            subject: 'Clicked secure link',
            requestId: 'req-email-webhook-redaction',
            payload: {
                type: 'email.clicked',
                data: {
                    to: ['recipient@example.test'],
                    subject: 'Clicked secure link',
                    click: {
                        link: '/reset-password?token=raw-reset-token&next=/account',
                    },
                },
            },
        });

        const created = EmailDeliveryLog.create.mock.calls[0][0];
        const summary = created.webhookEvents[0].summary;

        expect(summary).toContain('token=[REDACTED]');
        expect(JSON.stringify(created)).not.toContain('raw-reset-token');
    });
});
