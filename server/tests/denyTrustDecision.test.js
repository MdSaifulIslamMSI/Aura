const { denyTrustDecision } = require('../trust/middleware/denyTrustDecision');

const mockReqRes = () => {
  const req = {};
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
};

describe('denyTrustDecision', () => {
  test('denies BLOCK and QUARANTINE with 403 envelopes', () => {
    for (const kind of ['BLOCK', 'QUARANTINE']) {
      const { req, res, next } = mockReqRes();
      denyTrustDecision({ decision: kind, reason: 'risky', evidence: { decisionId: 'trust_1' } })(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'ACCESS_DENIED', reason: 'risky', decisionId: 'trust_1',
      }));
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('challenges step-up with 428 and requirements', () => {
    const { req, res, next } = mockReqRes();
    denyTrustDecision({ decision: 'CHALLENGE', requiredStepUp: 'webauthn', reason: 'new device' })(req, res, next);
    expect(res.status).toHaveBeenCalledWith(428);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'STEP_UP_REQUIRED', requiredStepUp: 'webauthn',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('throttles with 429', () => {
    const { req, res, next } = mockReqRes();
    denyTrustDecision({ decision: 'THROTTLE', reason: 'burst' })(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TRUST_THROTTLED' }));
  });

  test('passes through decisions it does not own', () => {
    const { req, res, next } = mockReqRes();
    denyTrustDecision({ decision: 'ALLOW' })(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('attaches the decision to the request', () => {
    const { req, res, next } = mockReqRes();
    const decision = { decision: 'BLOCK' };
    denyTrustDecision(decision)(req, res, next);
    expect(req.trustDecision).toBe(decision);
  });
});
