const {
    ALIEN_AUDIT_EVENTS,
    buildAlienAuditEvent,
} = require('../services/alienOtpAuditService');

describe('ALIEN OTP audit events', () => {
    test('redacts user, device, challenge, resource, nonce, and signature material', () => {
        const event = buildAlienAuditEvent({
            event: ALIEN_AUDIT_EVENTS.CHALLENGE_FAILED,
            req: {
                method: 'POST',
                requestId: 'req-1',
                originalUrl: '/api/admin/users/507f1f77bcf86cd799439011/disable',
                headers: {
                    'user-agent': 'jest-agent',
                    'x-forwarded-for': '203.0.113.9',
                },
            },
            userId: 'user-secret',
            deviceId: 'device-secret',
            tenantId: 'tenant-secret',
            resourceId: 'resource-secret',
            challengeId: 'alien_ch_secret',
            action: 'admin.user.disable',
            decision: 'deny',
            reasons: ['invalid_signature'],
            config: { strictMode: true, policyVersion: 'test' },
        });
        const serialized = JSON.stringify(event);

        expect(event.userIdHash).toHaveLength(16);
        expect(event.deviceIdHash).toHaveLength(16);
        expect(event.challengeIdHash).toHaveLength(16);
        expect(serialized).not.toContain('user-secret');
        expect(serialized).not.toContain('device-secret');
        expect(serialized).not.toContain('alien_ch_secret');
        expect(serialized).not.toContain('rawNonce');
        expect(serialized).not.toContain('signatureBase64Url');
    });
});
