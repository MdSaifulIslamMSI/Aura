const AppError = require('../utils/AppError');
const { buildTrustError } = require('../trust/trustErrors');

describe('trustErrors.buildTrustError', () => {
  test('maps BLOCK to 403 access denied', () => {
    const error = buildTrustError({ decision: 'BLOCK', reason: 'risky', evidence: {} });
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('ACCESS_DENIED');
    expect(error.reason).toBe('risky');
  });

  test('maps THROTTLE to 429 with throttle code', () => {
    const error = buildTrustError({ decision: 'THROTTLE', evidence: {} });
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe('TRUST_THROTTLED');
    expect(error.message).toMatch(/throttled/i);
  });

  test('maps CHALLENGE to 428 step-up with requirements', () => {
    const error = buildTrustError({
      decision: 'CHALLENGE', requiredStepUp: 'webauthn', evidence: { decisionId: 'trust_1' },
    });
    expect(error.statusCode).toBe(428);
    expect(error.code).toBe('STEP_UP_REQUIRED');
    expect(error.requiredStepUp).toBe('webauthn');
    expect(error.decisionId).toBe('trust_1');
  });

  test('defaults missing evidence safely', () => {
    const error = buildTrustError({ decision: 'BLOCK' });
    expect(error.decisionId).toBe('');
    expect(error.requiredStepUp).toBeNull();
  });
});
