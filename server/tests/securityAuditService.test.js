jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
}));

const logger = require('../utils/logger');
const {
    recordSecurityAuditEvent,
    redactAuditMeta,
} = require('../services/securityAuditService');

describe('security audit service', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('redacts secrets, tokens, cookies, and raw payloads', () => {
        const redacted = redactAuditMeta({
            authorization: 'Bearer secret-token',
            cookie: 'aura_sid=session-secret',
            otp: '123456',
            rawBody: '{"card":"4242424242424242"}',
            nested: {
                apiKey: 'secret-key',
                safe: 'kept',
            },
        });

        expect(redacted).toEqual({
            authorization: '[REDACTED]',
            cookie: '[REDACTED]',
            otp: '[REDACTED]',
            rawBody: '[REDACTED]',
            nested: {
                apiKey: '[REDACTED]',
                safe: 'kept',
            },
        });
    });

    test('records bounded audit event with IP truncation and user-agent hash', () => {
        const payload = recordSecurityAuditEvent({
            event: 'security.policy.denied',
            req: {
                requestId: 'req-1',
                method: 'POST',
                originalUrl: '/api/admin/users/507f1f77bcf86cd799439011/suspend?debug=true',
                ip: '203.0.113.42',
                headers: {
                    'user-agent': 'Mozilla secret browser',
                    authorization: 'Bearer secret-token',
                },
                user: { _id: 'admin-1' },
            },
            action: 'admin.users.mutate',
            resourceType: 'user',
            result: 'denied',
            reasonCode: 'webauthn_step_up_required',
            riskLevel: 'critical',
            meta: {
                authorization: 'Bearer secret-token',
                webhookSecret: 'webhook-secret-fixture',
            },
        });

        expect(payload).toMatchObject({
            event: 'security.policy.denied',
            requestId: 'req-1',
            actorId: 'admin-1',
            action: 'admin.users.mutate',
            path: '/api/admin/users/:id/suspend',
            ip: '203.0.113.0/24',
            meta: {
                authorization: '[REDACTED]',
                webhookSecret: '[REDACTED]',
            },
        });
        expect(payload.userAgent).not.toContain('Mozilla');
        expect(logger.warn).toHaveBeenCalledWith('security.audit_event', expect.objectContaining({
            reasonCode: 'webauthn_step_up_required',
        }));
    });
});
