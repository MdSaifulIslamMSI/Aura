const { actionRegistry, getActionPolicy, listActionPolicies } = require('../trust/policies/actionRegistry');
const { orderPolicies } = require('../trust/policies/orderPolicies');
const { paymentPolicies } = require('../trust/policies/paymentPolicies');

describe('trust actionRegistry', () => {
  test('merges every policy domain without key loss', () => {
    const domains = [orderPolicies, paymentPolicies];
    for (const domain of domains) {
      for (const action of Object.keys(domain)) {
        expect(actionRegistry[action]).toBe(domain[action]);
      }
    }
    expect(listActionPolicies().length).toBe(Object.keys(actionRegistry).length);
  });

  test('resolves known actions to their policies', () => {
    expect(getActionPolicy('order.read')).toMatchObject({ resourceType: 'order', requiresOwnership: true });
  });

  test('fails closed on unknown actions (admin-only + MFA step-up)', () => {
    const policy = getActionPolicy('teleportation.execute');
    expect(policy).toMatchObject({
      resourceType: 'unknown',
      allowedRoles: ['admin', 'super_admin'],
      requiresIdentity: true,
      sensitive: true,
      stepUp: 'MFA',
      audit: true,
      unknownAction: true,
    });
  });

  test('trims whitespace from action lookups', () => {
    expect(getActionPolicy('  order.read  ').action).toBe('order.read');
  });
});

describe('trust orderPolicies', () => {
  test('reads are ownership-scoped but not sensitive', () => {
    expect(orderPolicies['order.read']).toMatchObject({
      requiresOwnership: true,
      adminBypassesOwnership: true,
      sensitive: false,
      riskyWrite: false,
    });
  });

  test('cancels and refunds are sensitive writes with state guards', () => {
    expect(orderPolicies['order.cancel']).toMatchObject({ sensitive: true, riskyWrite: true });
    expect(orderPolicies['order.cancel'].denyStates).toContain('cancelled');
    expect(orderPolicies['order.refund.request']).toMatchObject({ stepUp: 'MFA', riskyWrite: true });
    expect(orderPolicies['order.refund.request'].allowedStates).toContain('delivered');
  });
});

describe('trust paymentPolicies', () => {
  test('every payment action audits and gates risk', () => {
    for (const [action, policy] of Object.entries(paymentPolicies)) {
      expect(policy.audit).toBe(true);
      expect(policy.riskThreshold).toBeGreaterThan(0);
      expect(policy.resourceType).toMatch(/^payment/);
    }
    expect(Object.keys(paymentPolicies).length).toBeGreaterThan(0);
  });
});
