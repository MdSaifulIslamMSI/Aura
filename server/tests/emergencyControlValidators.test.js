const {
  EMERGENCY_CONFIRMATION_PHRASE,
  activateEmergencyFlagSchema,
  deactivateEmergencyFlagSchema,
  extendEmergencyFlagSchema,
  listEmergencyAuditSchema,
  updateEmergencyMessageSchema,
} = require('../validators/emergencyControlValidators');

const params = { key: 'DISABLE_CHECKOUT' };
const query = {};

describe('emergencyControlValidators activation', () => {
  test('activates flags with reasons and severities', () => {
    expect(() => activateEmergencyFlagSchema.parse({
      params, query, body: { reason: 'Payment provider incident', severity: 'critical' },
    })).not.toThrow();
  });

  test('rejects unknown flag keys and severities', () => {
    expect(activateEmergencyFlagSchema.safeParse({ params: { key: 'NOPE' }, query, body: {} }).success).toBe(false);
    expect(activateEmergencyFlagSchema.safeParse({ params, query, body: { severity: 'apocalyptic' } }).success).toBe(false);
  });

  test('expiries accept ISO datetimes and reject garbage', () => {
    expect(() => activateEmergencyFlagSchema.parse({
      params, query, body: { expiresAt: new Date(Date.now() + 3600000).toISOString() },
    })).not.toThrow();
    expect(activateEmergencyFlagSchema.safeParse({
      params, query, body: { expiresAt: 'not-a-date' },
    }).success).toBe(false);
  });

  test('exposes the confirmation phrase constant', () => {
    expect(EMERGENCY_CONFIRMATION_PHRASE).toBe('I UNDERSTAND');
  });
});

describe('emergencyControlValidators lifecycle', () => {
  test('deactivates with optional reasons', () => {
    expect(() => deactivateEmergencyFlagSchema.parse({ params, query, body: { reason: 'All clear' } })).not.toThrow();
    expect(() => deactivateEmergencyFlagSchema.parse({ params, query, body: {} })).not.toThrow();
  });

  test('extends only with valid future expiries', () => {
    expect(extendEmergencyFlagSchema.safeParse({ params, query, body: {} }).success).toBe(false);
    expect(() => extendEmergencyFlagSchema.parse({
      params, query, body: { expiresAt: new Date(Date.now() + 7200000).toISOString() },
    })).not.toThrow();
  });

  test('message updates require non-empty content', () => {
    expect(updateEmergencyMessageSchema.safeParse({ params, query, body: { userMessage: '' } }).success).toBe(false);
    expect(() => updateEmergencyMessageSchema.parse({
      params, query, body: { userMessage: 'Checkout paused for maintenance.' },
    })).not.toThrow();
  });

  test('audit listing validates filters', () => {
    expect(() => listEmergencyAuditSchema.parse({ params: {}, query: {}, body: {} })).not.toThrow();
    expect(listEmergencyAuditSchema.safeParse({
      params: {}, query: { limit: '500' }, body: {},
    }).success).toBe(false);
  });
});
