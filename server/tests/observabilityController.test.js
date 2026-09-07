jest.mock('../services/clientDiagnosticIngestionService', () => ({
  MAX_DIAGNOSTICS_PER_REQUEST: 20,
  persistClientDiagnostics: jest.fn(),
  listClientDiagnostics: jest.fn(),
}));

const { listClientDiagnostics, persistClientDiagnostics } = require('../services/clientDiagnosticIngestionService');
const {
  getClientDiagnostics,
  ingestClientDiagnostics,
} = require('../controllers/observabilityController');

const mockReqRes = (overrides = {}) => {
  const req = {
    body: {}, query: {}, headers: {}, ip: '127.0.0.1', requestId: 'req-1',
    get: jest.fn(() => 'test-agent'),
    ...overrides,
  };
  const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() };
  return { req, res };
};

describe('observabilityController.ingestClientDiagnostics', () => {
  beforeEach(() => jest.clearAllMocks());

  test('accepts well-formed diagnostic batches with 202', async () => {
    persistClientDiagnostics.mockResolvedValue({ acceptedCount: 2, persistedCount: 2, persistenceMode: 'memory' });
    const { req, res } = mockReqRes({
      body: { events: [{ type: 'js_error', detail: 'boom' }, { type: 'nav', route: '/cart' }] },
      headers: { 'x-client-session-id': 'sess-1', 'x-client-route': '/cart' },
    });
    await ingestClientDiagnostics(req, res);

    expect(persistClientDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      ingestionRequestId: 'req-1',
      clientSessionId: 'sess-1',
      clientRoute: '/cart',
      clientIp: '127.0.0.1',
      userAgent: 'test-agent',
    }));
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted', accepted: 2 }));
  });

  test('rejects empty batches with structured 400 errors', async () => {
    const { req, res } = mockReqRes({ body: { events: [] } });
    await ingestClientDiagnostics(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    expect(persistClientDiagnostics).not.toHaveBeenCalled();
  });

  test('rejects events without a type', async () => {
    const { req, res } = mockReqRes({ body: { events: [{ detail: 'typeless' }] } });
    await ingestClientDiagnostics(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.requestId).toBe('req-1');
  });
});

describe('observabilityController.getClientDiagnostics', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists diagnostics with counts and source', async () => {
    listClientDiagnostics.mockResolvedValue({ source: 'memory', diagnostics: [{ id: 'd-1' }] });
    const { req, res } = mockReqRes({ query: { limit: '10', type: 'js_error' } });
    await getClientDiagnostics(req, res);
    expect(listClientDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, type: 'js_error' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, source: 'memory', count: 1 }));
  });

  test('rejects out-of-range limits with 400', async () => {
    const { req, res } = mockReqRes({ query: { limit: '5000' } });
    await getClientDiagnostics(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(listClientDiagnostics).not.toHaveBeenCalled();
  });
});
