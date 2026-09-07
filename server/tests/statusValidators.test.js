const {
  adminStatusComponentCreateSchema,
  adminStatusComponentUpdateSchema,
  adminStatusIncidentCreateSchema,
  adminStatusIncidentResolveSchema,
  adminStatusMaintenanceCreateSchema,
  statusHistorySchema,
  statusIncidentDetailSchema,
  statusSubscribeSchema,
  statusUnsubscribeSchema,
} = require('../validators/statusValidators');

const OBJECT_ID = '507f1f77bcf86cd799439011';

describe('statusValidators public schemas', () => {
  test('history bounds filters and pagination', () => {
    expect(() => statusHistorySchema.parse({ query: { type: 'incidents' }, params: {}, body: {} })).not.toThrow();
    expect(statusHistorySchema.safeParse({ query: { type: 'weather' }, params: {}, body: {} }).success).toBe(false);
  });

  test('incident details validate slugs', () => {
    expect(() => statusIncidentDetailSchema.parse({ query: {}, params: { slug: 'db-failover' }, body: {} })).not.toThrow();
    expect(statusIncidentDetailSchema.safeParse({ query: {}, params: { slug: '' }, body: {} }).success).toBe(false);
  });

  test('subscriptions require valid emails', () => {
    expect(() => statusSubscribeSchema.parse({ query: {}, params: {}, body: { email: 'u@example.com' } })).not.toThrow();
    expect(statusSubscribeSchema.safeParse({ query: {}, params: {}, body: { email: 'nope' } }).success).toBe(false);
  });

  test('unsubscribes require tokens', () => {
    expect(statusUnsubscribeSchema.safeParse({ query: {}, params: {}, body: {} }).success).toBe(false);
  });
});

describe('statusValidators admin schemas', () => {
  test('incidents require titles', () => {
    expect(() => adminStatusIncidentCreateSchema.parse({ query: {}, params: {}, body: { title: 'DB failover' } })).not.toThrow();
    expect(adminStatusIncidentCreateSchema.safeParse({ query: {}, params: {}, body: { title: '' } }).success).toBe(false);
  });

  test('component updates scope to ObjectIds', () => {
    expect(adminStatusComponentUpdateSchema.safeParse({
      query: {}, params: { id: 'nope' }, body: {},
    }).success).toBe(false);
  });

  test('maintenance windows require scheduled bounds', () => {
    expect(() => adminStatusMaintenanceCreateSchema.parse({
      query: {}, params: {},
      body: { title: 'Upgrade', scheduledStartAt: '2026-10-01T00:00:00Z', scheduledEndAt: '2026-10-01T02:00:00Z' },
    })).not.toThrow();
    expect(adminStatusMaintenanceCreateSchema.safeParse({
      query: {}, params: {}, body: { title: 'Upgrade' },
    }).success).toBe(false);
  });

  test('incident resolution validates ids', () => {
    expect(adminStatusIncidentResolveSchema.safeParse({
      query: {}, params: { id: 'bad' }, body: {},
    }).success).toBe(false);
    expect(() => adminStatusIncidentResolveSchema.parse({
      query: {}, params: { id: OBJECT_ID }, body: {},
    })).not.toThrow();
  });

  test('component creation validates payloads', () => {
    expect(adminStatusComponentCreateSchema.safeParse({ query: {}, params: {}, body: {} }).success).toBe(false);
  });
});
