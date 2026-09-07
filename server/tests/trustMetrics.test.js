const {
  getTrustMetricsSnapshot,
  recordTrustMetric,
  resetTrustMetrics,
} = require('../trust/metrics/trustMetrics');

describe('trustMetrics', () => {
  beforeEach(() => resetTrustMetrics());

  test('starts from a zero snapshot', () => {
    expect(getTrustMetricsSnapshot()).toEqual({ decisions: 0, byDecision: {}, byReason: {} });
  });

  test('counts decisions by kind and reason', () => {
    recordTrustMetric({ decision: { decision: 'ALLOW', reason: 'low risk' } });
    recordTrustMetric({ decision: { decision: 'ALLOW', reason: 'low risk' } });
    recordTrustMetric({ decision: { decision: 'BLOCK', reason: 'high risk' } });
    expect(getTrustMetricsSnapshot()).toEqual({
      decisions: 3,
      byDecision: { ALLOW: 2, BLOCK: 1 },
      byReason: { 'low risk': 2, 'high risk': 1 },
    });
  });

  test('buckets missing fields as unknown', () => {
    recordTrustMetric({});
    expect(getTrustMetricsSnapshot().byDecision.unknown).toBe(1);
    expect(getTrustMetricsSnapshot().byReason.unknown).toBe(1);
  });

  test('resets cleanly between windows', () => {
    recordTrustMetric({ decision: { decision: 'ALLOW' } });
    resetTrustMetrics();
    expect(getTrustMetricsSnapshot().decisions).toBe(0);
  });
});
