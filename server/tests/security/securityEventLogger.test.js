const {
    __getBufferedEvents,
    __resetBufferedEvents,
    writeSecurityEvent,
} = require('../../security/securityEventLogger');
const { redactSecurityMetadata } = require('../../security/redactSecurityMetadata');

describe('securityEventLogger', () => {
    beforeEach(() => {
        __resetBufferedEvents();
    });

    test('redacts secrets from metadata', () => {
        const redacted = redactSecurityMetadata({
            password: 'plaintext',
            nested: { apiKey: 'sk_test_abcdefghijklmnopqrstuvwxyz' },
            proof: 'raw-dpop-proof-fixture',
            safe: 'kept',
        });

        expect(redacted.password).toBe('[REDACTED]');
        expect(redacted.nested.apiKey).toBe('[REDACTED]');
        expect(redacted.proof).toBe('[REDACTED]');
        expect(redacted.safe).toBe('kept');
    });

    test('writes bounded safe event records', () => {
        const event = writeSecurityEvent({
            event: 'access.denied',
            userId: 'user-1',
            tenantId: 'tenant-1',
            action: 'data.export',
            route: '/api/admin/analytics/export',
            method: 'GET',
            ipHash: 'ip-hash',
            userAgentHash: 'ua-hash',
            riskScore: 90,
            decision: 'CONTAIN',
            reasonCode: 'risk_high',
            metadata: { token: 'secret-token-value' },
        });

        expect(event.metadata.token).toBe('[REDACTED]');
        expect(__getBufferedEvents()).toHaveLength(1);
    });
});
