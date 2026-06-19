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

    test('redacts sensitive object-valued audit metadata before nested traversal', () => {
        const redacted = redactAuditMeta({
            authToken: {
                uid: 'oidc-subject-sensitive',
                email: 'oidc.user@example.test',
                nested: {
                    accessToken: 'raw-jwt-secret-fixture',
                },
            },
            credentialProof: {
                challenge: 'raw-credential-proof-fixture',
            },
            safe: {
                email: 'visible-only-in-safe-fixture',
            },
        });
        const serialized = JSON.stringify(redacted);

        expect(redacted.authToken).toBe('[REDACTED]');
        expect(redacted.credentialProof).toBe('[REDACTED]');
        expect(redacted.safe.email).toBe('visible-only-in-safe-fixture');
        expect(serialized).not.toContain('oidc-subject-sensitive');
        expect(serialized).not.toContain('oidc.user@example.test');
        expect(serialized).not.toContain('raw-jwt-secret-fixture');
        expect(serialized).not.toContain('raw-credential-proof-fixture');
    });

    test('redacts secret-shaped strings from non-sensitive audit text fields', () => {
        const bearer = ['Bearer ', 'eyJhbGci.audit.fixture'].join('');
        const webhookSecret = ['whsec_', 'auditfixture'].join('');
        const redacted = redactAuditMeta({
            reason: `provider rejected ${bearer}`,
            note: `webhook verifier received ${webhookSecret}`,
        });
        const serialized = JSON.stringify(redacted);

        expect(redacted.reason).toBe('provider rejected [REDACTED]');
        expect(redacted.note).toBe('webhook verifier received [REDACTED]');
        expect(serialized).not.toContain(bearer);
        expect(serialized).not.toContain(webhookSecret);
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
            resourceId: 'target-user-1',
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
            action: 'admin.users.mutate',
            path: '/api/admin/users/:id/suspend',
            ip: '203.0.113.0/24',
            meta: {
                authorization: '[REDACTED]',
                webhookSecret: '[REDACTED]',
            },
        });
        expect(payload.actorId).toMatch(/^[a-f0-9]{16}$/);
        expect(payload.actorId).not.toBe('admin-1');
        expect(payload.resourceId).toMatch(/^[a-f0-9]{16}$/);
        expect(payload.resourceId).not.toBe('target-user-1');
        expect(payload.userAgent).not.toContain('Mozilla');
        expect(logger.warn).toHaveBeenCalledWith('security.audit_event', expect.objectContaining({
            reasonCode: 'webauthn_step_up_required',
        }));
    });
});
