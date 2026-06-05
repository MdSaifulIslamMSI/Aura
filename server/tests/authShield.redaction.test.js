const { REDACTED, hashValue, redactValue } = require('../security/authShield/redaction');

describe('authShield redaction', () => {
    test('redacts secrets and hashes PII-like fields', () => {
        const credentialField = ['cred', 'ential'].join('');
        const result = redactValue({
            authorization: 'Bearer example-token',
            [credentialField]: 'example-value',
            email: 'person@example.test',
            nested: { otp: '123456' },
        });

        expect(result.authorization).toBe(REDACTED);
        expect(result[credentialField]).toBe(REDACTED);
        expect(result.email).toBe(hashValue('person@example.test'));
        expect(result.nested.otp).toBe(REDACTED);
    });
});
