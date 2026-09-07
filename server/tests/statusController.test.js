jest.mock('../models/StatusCheck', () => ({ find: jest.fn(), create: jest.fn() }));
jest.mock('../models/StatusSubscriber', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../services/statusService', () => ({
  getPublicStatus: jest.fn(),
  getPublicStatusComponents: jest.fn(),
  getActiveStatusIncidents: jest.fn(),
  getStatusHistory: jest.fn(),
  getStatusMaintenance: jest.fn(),
  getStatusSummary: jest.fn(),
  getIncidentBySlug: jest.fn(),
  subscribeToStatus: jest.fn(),
  unsubscribeFromStatus: jest.fn(),
  verifyStatusSubscription: jest.fn(),
  getStatusAdminDashboard: jest.fn(),
}));

const statusService = require('../services/statusService');
const {
  getActiveStatusIncidentsController,
  getPublicStatusController,
  getStatusHistoryController,
  getStatusMaintenanceController,
  getStatusSummaryController,
  subscribeStatusController,
  unsubscribeStatusController,
  verifyStatusSubscriptionController,
} = require('../controllers/statusController');

const mockReqRes = (overrides = {}) => {
  const req = { body: {}, params: {}, query: {}, ...overrides };
  const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
};

describe('statusController public reads', () => {
  beforeEach(() => jest.clearAllMocks());

  test('serves the public status payload with edge caching', async () => {
    statusService.getPublicStatus.mockResolvedValue({ overallStatus: 'operational' });
    const { req, res } = mockReqRes();
    await getPublicStatusController(req, res, jest.fn());
    expect(res.set).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('max-age=30'));
    expect(res.json).toHaveBeenCalledWith({ overallStatus: 'operational' });
  });

  test('forwards history queries to the service', async () => {
    statusService.getStatusHistory.mockResolvedValue([{ date: '2026-09-01' }]);
    const { req, res } = mockReqRes({ query: { page: '2', type: 'incident' } });
    await getStatusHistoryController(req, res, jest.fn());
    expect(statusService.getStatusHistory).toHaveBeenCalledWith({ page: '2', type: 'incident' });
  });

  test('parses the includePast maintenance flag strictly', async () => {
    statusService.getStatusMaintenance.mockResolvedValue([]);
    const { req, res } = mockReqRes({ query: { includePast: 'true' } });
    await getStatusMaintenanceController(req, res, jest.fn());
    expect(statusService.getStatusMaintenance).toHaveBeenCalledWith({ includePast: true });

    const plain = mockReqRes({ query: {} });
    await getStatusMaintenanceController(plain.req, plain.res, jest.fn());
    expect(statusService.getStatusMaintenance).toHaveBeenLastCalledWith({ includePast: false });
  });

  test('serves incidents and summaries', async () => {
    statusService.getActiveStatusIncidents.mockResolvedValue([{ slug: 'db-failover' }]);
    statusService.getStatusSummary.mockResolvedValue({ overallStatus: 'degraded' });

    const incidents = mockReqRes();
    await getActiveStatusIncidentsController(incidents.req, incidents.res, jest.fn());
    expect(incidents.res.json).toHaveBeenCalledWith([{ slug: 'db-failover' }]);

    const summary = mockReqRes();
    await getStatusSummaryController(summary.req, summary.res, jest.fn());
    expect(summary.res.json).toHaveBeenCalledWith({ overallStatus: 'degraded' });
  });
});

describe('statusController subscriptions', () => {
  beforeEach(() => jest.clearAllMocks());

  test('subscribes with the request body and a 201 envelope', async () => {
    statusService.subscribeToStatus.mockResolvedValue({ id: 'sub-1' });
    const { req, res } = mockReqRes({ body: { email: 'u@example.com' } });
    await subscribeStatusController(req, res, jest.fn());
    expect(statusService.subscribeToStatus).toHaveBeenCalledWith({ email: 'u@example.com' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, subscription: { id: 'sub-1' } }));
  });

  test('unsubscribes and verifies with success envelopes', async () => {
    statusService.unsubscribeFromStatus.mockResolvedValue({ ok: true });
    statusService.verifyStatusSubscription.mockResolvedValue({ verified: true });

    const unsub = mockReqRes({ body: { token: 'tok-1' } });
    await unsubscribeStatusController(unsub.req, unsub.res, jest.fn());
    expect(statusService.unsubscribeFromStatus).toHaveBeenCalledWith({ token: 'tok-1' });
    expect(unsub.res.json).toHaveBeenCalledWith({ success: true, ok: true });

    const verify = mockReqRes({ query: { token: 'tok-1' } });
    await verifyStatusSubscriptionController(verify.req, verify.res, jest.fn());
    expect(statusService.verifyStatusSubscription).toHaveBeenCalledWith({ token: 'tok-1' });
    expect(verify.res.json).toHaveBeenCalledWith({ success: true, verified: true });
  });
});
