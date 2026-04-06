jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

jest.mock('../services/email/index', () => ({
    sendTransactionalEmail: jest.fn(),
}));

jest.mock('../services/email/templates/activityTemplate', () => ({
    renderActivityTemplate: jest.fn(),
}));

jest.mock('../models/EmailDeliveryLog', () => ({
    findOne: jest.fn(),
}));

jest.mock('mongoose', () => ({
    connection: { readyState: 1 },
}));

const EmailDeliveryLog = require('../models/EmailDeliveryLog');
const { sendTransactionalEmail } = require('../services/email/index');
const { renderActivityTemplate } = require('../services/email/templates/activityTemplate');
const {
    notifyActivityFromRequest,
    resetActivityEmailPolicyStateForTests,
    EMAIL_NOTIFICATION_POLICIES,
} = require('../services/email/activityEmailService');

const buildRequest = (overrides = {}) => ({
    method: 'PUT',
    originalUrl: '/api/users/profile',
    user: {
        _id: 'user-1',
        name: 'Md Saiful Islam',
        email: 'mdsaifulislam38msi@gmail.com',
    },
    body: {},
    headers: { 'user-agent': 'Mozilla/5.0' },
    ip: '127.0.0.1',
    requestId: 'req-activity-1',
    ...overrides,
});

const buildResponse = (statusCode = 200) => ({ statusCode });

describe('activityEmailService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetActivityEmailPolicyStateForTests();
        EmailDeliveryLog.findOne.mockResolvedValue(null);
        renderActivityTemplate.mockReturnValue({
            subject: 'AURA Security Activity',
            html: '<p>ok</p>',
            text: 'ok',
        });
        sendTransactionalEmail.mockResolvedValue({
            provider: 'gmail',
            providerMessageId: 'msg-1',
            response: { id: 'msg-1' },
        });
    });

    test('suppresses cart activity emails into digest-only policy', async () => {
        const result = await notifyActivityFromRequest({
            req: buildRequest({
                method: 'POST',
                originalUrl: '/api/cart/commands',
                body: {
                    commands: [{ type: 'add_item', productId: 1, quantity: 1 }],
                },
            }),
            res: buildResponse(200),
            durationMs: 120,
        });

        expect(result).toEqual({ skipped: true, reason: 'digest_only' });
        expect(sendTransactionalEmail).not.toHaveBeenCalled();
        expect(EmailDeliveryLog.findOne).not.toHaveBeenCalled();
    });

    test('suppresses unknown generic actions', async () => {
        const result = await notifyActivityFromRequest({
            req: buildRequest({
                method: 'POST',
                originalUrl: '/api/experimental/unknown-action',
            }),
            res: buildResponse(200),
            durationMs: 90,
        });

        expect(result).toEqual({ skipped: true, reason: 'generic_action_suppressed' });
        expect(sendTransactionalEmail).not.toHaveBeenCalled();
    });

    test('sends high-signal profile update emails with delivery metadata', async () => {
        const result = await notifyActivityFromRequest({
            req: buildRequest({
                method: 'PUT',
                originalUrl: '/api/users/profile',
                body: { name: 'Updated Name' },
            }),
            res: buildResponse(200),
            durationMs: 150,
        });

        expect(result).toEqual({ skipped: false });
        expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
        expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'user_activity',
            to: 'mdsaifulislam38msi@gmail.com',
            securityTags: ['user-activity', 'profile.updated', 'put'],
            meta: expect.objectContaining({
                actionKey: 'profile.updated',
                notificationPolicy: EMAIL_NOTIFICATION_POLICIES.IMPORTANT,
                deliveryClass: EMAIL_NOTIFICATION_POLICIES.IMPORTANT,
                policyVersion: 'activity-email-v2',
                path: '/api/users/profile',
            }),
            headers: expect.objectContaining({
                'X-Aura-Activity-Policy': EMAIL_NOTIFICATION_POLICIES.IMPORTANT,
            }),
        }));
    });

    test('marks refund requests as critical notifications', async () => {
        const result = await notifyActivityFromRequest({
            req: buildRequest({
                method: 'POST',
                originalUrl: '/api/orders/abc123/command-center/refund',
            }),
            res: buildResponse(200),
            durationMs: 95,
        });

        expect(result).toEqual({ skipped: false });
        expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
            headers: expect.objectContaining({
                'X-Aura-Activity-Policy': EMAIL_NOTIFICATION_POLICIES.CRITICAL,
            }),
            meta: expect.objectContaining({
                notificationPolicy: EMAIL_NOTIFICATION_POLICIES.CRITICAL,
                deliveryClass: EMAIL_NOTIFICATION_POLICIES.CRITICAL,
            }),
        }));
    });

    test('suppresses recent persistent duplicate activity emails', async () => {
        EmailDeliveryLog.findOne.mockResolvedValueOnce({
            createdAt: new Date(),
        });

        const result = await notifyActivityFromRequest({
            req: buildRequest({
                method: 'PUT',
                originalUrl: '/api/users/profile',
            }),
            res: buildResponse(200),
            durationMs: 110,
        });

        expect(result).toEqual({ skipped: true, reason: 'cooldown' });
        expect(sendTransactionalEmail).not.toHaveBeenCalled();
    });

    test('suppresses immediate in-memory duplicate sends for the same action', async () => {
        const payload = {
            req: buildRequest({
                method: 'PUT',
                originalUrl: '/api/users/profile',
            }),
            res: buildResponse(200),
            durationMs: 100,
        };

        const first = await notifyActivityFromRequest(payload);
        const second = await notifyActivityFromRequest(payload);

        expect(first).toEqual({ skipped: false });
        expect(second).toEqual({ skipped: true, reason: 'cooldown' });
        expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    });
});
