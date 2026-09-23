jest.mock('../middleware/authMiddleware', () => ({
  protect: (req, res, next) => {
    req.user = {
      _id: '69aa0000000000000000admin',
      email: 'admin@example.com',
      isAdmin: true,
    };
    return next();
  },
  admin: (req, res, next) => next(),
}));

jest.mock('../middleware/routeSecurityGuards', () => ({
  sensitiveActions: {
    adminSecurityConfigChange: (req, res, next) => next(),
  },
}));

jest.mock('../services/abuseScoreService', () => ({
  addTemporaryDeny: jest.fn().mockResolvedValue(undefined),
  getMemoryDenylistSnapshot: jest.fn().mockReturnValue([]),
  normalizeIdentity: jest.requireActual('../services/abuseScoreService').normalizeIdentity,
  removeTemporaryDeny: jest.fn().mockResolvedValue(undefined),
}));

const express = require('express');
const request = require('supertest');
const adminAbuseRoutes = require('../routes/adminAbuseRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const { addTemporaryDeny, removeTemporaryDeny } = require('../services/abuseScoreService');

const buildTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/abuse', adminAbuseRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

describe('Admin abuse routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildTestApp();
  });

  test('GET /api/admin/abuse/state returns traffic posture snapshot', async () => {
    const res = await request(app).get('/api/admin/abuse/state');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(res.body).toHaveProperty('trafficFortressEnabled');
    expect(res.body).toHaveProperty('attackMode');
    expect(res.body).toHaveProperty('denylist');
  });

  test('POST /api/admin/abuse/denylist rejects missing identity with message', async () => {
    const res = await request(app).post('/api/admin/abuse/denylist').send({ ttlSeconds: 900 });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_DENYLIST_IDENTITY',
    });
    expect(typeof res.body.message).toBe('string');
    expect(addTemporaryDeny).not.toHaveBeenCalled();
  });

  test('POST /api/admin/abuse/denylist falls back to 900s on NaN ttl', async () => {
    const res = await request(app)
      .post('/api/admin/abuse/denylist')
      .send({ identity: '192.0.2.10', ttlSeconds: 'not-a-number', reason: 'manual' });

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ success: true, ttlSeconds: 900 });
    expect(addTemporaryDeny).toHaveBeenCalledWith(
      expect.objectContaining({ identity: '192.0.2.10', ttlSeconds: 900 })
    );
  });

  test('POST /api/admin/abuse/denylist clamps ttl into 60..86400', async () => {
    const low = await request(app)
      .post('/api/admin/abuse/denylist')
      .send({ identity: '192.0.2.11', ttlSeconds: 5 });
    expect(low.body.ttlSeconds).toBe(60);

    const high = await request(app)
      .post('/api/admin/abuse/denylist')
      .send({ identity: '192.0.2.12', ttlSeconds: 999999 });
    expect(high.body.ttlSeconds).toBe(86400);
  });

  test('DELETE /api/admin/abuse/denylist/:identity removes entry', async () => {
    const res = await request(app).delete('/api/admin/abuse/denylist/192.0.2.10');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, identity: '192.0.2.10' });
    expect(removeTemporaryDeny).toHaveBeenCalledWith('192.0.2.10');
  });
});
