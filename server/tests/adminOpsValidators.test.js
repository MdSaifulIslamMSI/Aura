const {
  adminClientDiagnosticsSchema,
  adminOpsAwsControlActionSchema,
  adminOpsMaintenanceSchema,
  adminOpsReadinessSchema,
  adminOpsSmokeSchema,
} = require('../validators/adminOpsValidators');

describe('adminOpsValidators readiness and smoke', () => {
  test('readiness and smoke accept open envelopes', () => {
    expect(() => adminOpsReadinessSchema.parse({ query: {}, params: {} })).not.toThrow();
    expect(() => adminOpsSmokeSchema.parse({ query: { target: 'api' }, params: {} })).not.toThrow();
  });

  test('diagnostics bound page sizes', () => {
    expect(() => adminClientDiagnosticsSchema.parse({ query: { limit: '20' }, params: {} })).not.toThrow();
    expect(adminClientDiagnosticsSchema.safeParse({ query: { limit: '500' }, params: {} }).success).toBe(false);
  });
});

describe('adminOpsValidators maintenance and cloud control', () => {
  test('maintenance tasks stay within the known set', () => {
    expect(() => adminOpsMaintenanceSchema.parse({
      query: {}, params: {}, body: { tasks: ['paymentOutbox', 'orderEmail'] },
    })).not.toThrow();
    expect(adminOpsMaintenanceSchema.safeParse({
      query: {}, params: {}, body: { tasks: ['self-destruct'] },
    }).success).toBe(false);
  });

  test('aws control gates targets, actions and reasons', () => {
    expect(() => adminOpsAwsControlActionSchema.parse({
      query: {}, params: {},
      body: { target: 'staging', action: 'stop', reason: 'Cost saving overnight' },
    })).not.toThrow();
    expect(adminOpsAwsControlActionSchema.safeParse({
      query: {}, params: {},
      body: { target: 'production', action: 'stop', reason: 'short' },
    }).success).toBe(false);
    expect(adminOpsAwsControlActionSchema.safeParse({
      query: {}, params: {},
      body: { target: 'moon', action: 'stop', reason: 'Cost saving overnight' },
    }).success).toBe(false);
  });
});
