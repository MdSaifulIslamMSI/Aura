jest.mock('../trust/trustFabric', () => ({ evaluate: jest.fn() }));
jest.mock('../trust/trustContext', () => ({
  buildTrustContext: jest.fn((req) => ({ requestId: req.requestId || 'ctx-1' })),
}));
jest.mock('../trust/audit/trustAuditLogger', () => ({ recordTrustDecision: jest.fn() }));

const trustFabric = require('../trust/trustFabric');
const { requireTrustDecision } = require('../trust/middleware/requireTrustDecision');

const mockReqRes = (overrides = {}) => {
  const req = { headers: {}, user: { _id: 'u-1' }, ...overrides };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
};

describe('requireTrustDecision', () => {
  beforeEach(() => jest.clearAllMocks());

  test('attaches allowed decisions and continues', async () => {
    trustFabric.evaluate.mockResolvedValue({ allowed: true, decision: 'ALLOW' });
    const { req, res, next } = mockReqRes();
    await requireTrustDecision('order.read', { id: 'o-1' })(req, res, next);
    expect(req.trustDecision).toMatchObject({ allowed: true });
    expect(req.trustContext).toBeDefined();
    expect(next).toHaveBeenCalledWith();
  });

  test('denies blocked decisions without calling next()', async () => {
    trustFabric.evaluate.mockResolvedValue({ allowed: false, decision: 'BLOCK', reason: 'risk' });
    const { req, res, next } = mockReqRes();
    await requireTrustDecision('order.cancel', { id: 'o-1' })(req, res, next);
    expect(next).not.toHaveBeenCalledWith();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('resolves resources through loader functions', async () => {
    trustFabric.evaluate.mockResolvedValue({ allowed: true, decision: 'ALLOW' });
    const loader = jest.fn(async () => ({ id: 'o-9' }));
    const { req, res, next } = mockReqRes();
    await requireTrustDecision('order.read', loader)(req, res, next);
    expect(loader).toHaveBeenCalledWith(req);
    expect(trustFabric.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'order.read', resource: { id: 'o-9' },
    }));
    expect(next).toHaveBeenCalled();
  });

  test('resolves actors from options or the request user', async () => {
    trustFabric.evaluate.mockResolvedValue({ allowed: true, decision: 'ALLOW' });
    const first = mockReqRes();
    await requireTrustDecision('order.read', null, { actor: { _id: 'service' } })(first.req, first.res, first.next);
    expect(trustFabric.evaluate).toHaveBeenCalledWith(expect.objectContaining({ actor: { _id: 'service' } }));

    const second = mockReqRes();
    await requireTrustDecision('order.read')(second.req, second.res, second.next);
    expect(trustFabric.evaluate).toHaveBeenLastCalledWith(expect.objectContaining({ actor: { _id: 'u-1' } }));
  });

  test('forwards fabric failures to the error handler', async () => {
    trustFabric.evaluate.mockRejectedValue(new Error('fabric down'));
    const { req, res, next } = mockReqRes();
    await requireTrustDecision('order.read')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
