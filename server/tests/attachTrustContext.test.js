jest.mock('../trust/trustContext', () => ({
  buildTrustContext: jest.fn((req) => ({ requestId: req.requestId || 'ctx-1' })),
}));

const { buildTrustContext } = require('../trust/trustContext');
const { attachTrustContext } = require('../trust/middleware/attachTrustContext');

describe('attachTrustContext', () => {
  beforeEach(() => jest.clearAllMocks());

  test('builds and attaches the context then continues', () => {
    const req = { requestId: 'req-9', headers: {} };
    const next = jest.fn();
    attachTrustContext(req, {}, next);
    expect(buildTrustContext).toHaveBeenCalledWith(req);
    expect(req.trustContext).toEqual({ requestId: 'req-9' });
    expect(next).toHaveBeenCalledWith();
  });

  test('works without request ids', () => {
    const req = { headers: {} };
    attachTrustContext(req, {}, jest.fn());
    expect(req.trustContext).toEqual({ requestId: 'ctx-1' });
  });
});
