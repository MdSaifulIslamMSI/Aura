const { hashValue, redactTrustValue, truncateIp } = require('../trust/audit/trustRedactor');

describe('trustRedactor.redactTrustValue', () => {
  test('redacts sensitive keys by name', () => {
    for (const key of ['authorization', 'password', 'api_key', 'cardNumber', 'otp', 'signature', 'cookie']) {
      expect(redactTrustValue('secret-value', key)).toBe('[REDACTED]');
    }
  });

  test('passes through benign keys', () => {
    expect(redactTrustValue('Phone', 'title')).toBe('Phone');
    expect(redactTrustValue(42, 'price')).toBe(42);
  });

  test('redacts nested objects and arrays recursively', () => {
    const redacted = redactTrustValue({ user: { password: 'x', name: 'Asha' }, tags: ['a'] }, 'body');
    expect(redacted).toEqual({ user: { password: '[REDACTED]', name: 'Asha' }, tags: ['a'] });
  });

  test('truncates IPs and hashes agents and ids', () => {
    expect(redactTrustValue('192.168.1.101', 'clientIp')).toBe('192.168.1.0/24');
    expect(redactTrustValue('2001:db8:abcd:0012::0', 'ip')).toContain('/48');
    expect(redactTrustValue('Mozilla/5.0', 'userAgent')).toHaveLength(16);
    expect(redactTrustValue('u-1', 'actorId')).toHaveLength(16);
  });

  test('scrubs bearer tokens and provider secrets from free text', () => {
    expect(redactTrustValue('call with Bearer abc123XYZ now', 'message')).toContain('[REDACTED]');
    expect(redactTrustValue('key sk_test_ABCDEF123', 'note')).toContain('[REDACTED]');
  });

  test('preserves nulls and serializes dates', () => {
    expect(redactTrustValue(null, 'x')).toBeNull();
    expect(redactTrustValue(undefined, 'x')).toBeUndefined();
    expect(redactTrustValue(new Date('2026-01-01T00:00:00.000Z'), 'at')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('trustRedactor helpers', () => {
  test('hashValue is a stable 16-hex fingerprint', () => {
    expect(hashValue('abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashValue('abc')).toBe(hashValue('abc'));
    expect(hashValue('abc')).not.toBe(hashValue('abd'));
  });

  test('truncateIp handles v4, v6 and blanks', () => {
    expect(truncateIp('10.0.0.8')).toBe('10.0.0.0/24');
    expect(truncateIp('')).toBe('');
  });
});
