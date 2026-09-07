const {
  adminFraudDecisionListSchema,
  adminFraudDecisionResolveSchema,
} = require('../validators/fraudDecisionValidators');

const OBJECT_ID = '507f1f77bcf86cd799439011';

describe('fraudDecisionValidators listing', () => {
  test('accepts bounded filters', () => {
    expect(() => adminFraudDecisionListSchema.parse({
      query: { status: 'open', decision: 'review', page: '2', limit: '20' },
    })).not.toThrow();
  });

  test('rejects unknown statuses, decisions and oversized pages', () => {
    expect(adminFraudDecisionListSchema.safeParse({ query: { status: 'maybe' } }).success).toBe(false);
    expect(adminFraudDecisionListSchema.safeParse({ query: { decision: 'banish' } }).success).toBe(false);
    expect(adminFraudDecisionListSchema.safeParse({ query: { limit: '500' } }).success).toBe(false);
  });

  test('validates user id filters as ObjectIds', () => {
    expect(adminFraudDecisionListSchema.safeParse({ query: { userId: 'nope' } }).success).toBe(false);
    expect(() => adminFraudDecisionListSchema.parse({ query: { userId: OBJECT_ID } })).not.toThrow();
  });
});

describe('fraudDecisionValidators resolution', () => {
  test('resolves with a closed decision set', () => {
    expect(() => adminFraudDecisionResolveSchema.parse({
      params: { decisionId: OBJECT_ID },
      body: { resolution: 'escalate', note: 'Needs senior review.', assignedTo: OBJECT_ID },
    })).not.toThrow();
  });

  test('rejects unknown resolutions and malformed ids', () => {
    expect(adminFraudDecisionResolveSchema.safeParse({
      params: { decisionId: OBJECT_ID }, body: { resolution: 'banish' },
    }).success).toBe(false);
    expect(adminFraudDecisionResolveSchema.safeParse({
      params: { decisionId: 'bad' }, body: { resolution: 'approve' },
    }).success).toBe(false);
  });
});
