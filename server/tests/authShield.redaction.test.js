const { REDACTED, hashValue, redactValue } = require('../security/authShield/redaction');

describe('authShield redaction', () => {
    test('redacts secrets and hashes PII-like fields', () => {
        const credentialField = ['cred', 'ential'].join('');
        const result = redactValue({
            authorization: 'Bearer example-token',
            [credentialField]: 'example-value',
            signatureBase64Url: 'signature-material',
            email: 'person@example.test',
            nested: { otp: '123456' },
        });

        expect(result.authorization).toBe(REDACTED);
        expect(result[credentialField]).toBe(REDACTED);
        expect(result.signatureBase64Url).toBe(REDACTED);
        expect(result.email).toBe(hashValue('person@example.test'));
        expect(result.nested.otp).toBe(REDACTED);
    });

    test('redacts sensitive object values before nested traversal', () => {
        const rawToken = ['Bearer ', 'eyJhbGci.authshield.fixture'].join('');
        const result = redactValue({
            authToken: {
                uid: 'subject-sensitive',
                email: 'shield.user@example.test',
                nested: {
                    authorization: rawToken,
                },
            },
            profile: {
                email: 'shield.user@example.test',
            },
        });
        const serialized = JSON.stringify(result);

        expect(result.authToken).toBe(REDACTED);
        expect(result.profile.email).toBe(hashValue('shield.user@example.test'));
        expect(serialized).not.toContain('subject-sensitive');
        expect(serialized).not.toContain('shield.user@example.test');
        expect(serialized).not.toContain(rawToken);
    });

    test('redacts secret-shaped text from non-sensitive fields', () => {
        const bearer = ['Bearer ', 'eyJhbGci.authshield.note'].join('');
        const webhookSecret = ['whsec_', 'authshieldfixture'].join('');
        const result = redactValue({
            reason: `provider failed with ${bearer}`,
            note: `webhook mismatch ${webhookSecret}`,
        });

        expect(result.reason).toBe('provider failed with [REDACTED]');
        expect(result.note).toBe('webhook mismatch [REDACTED]');
    });
});
