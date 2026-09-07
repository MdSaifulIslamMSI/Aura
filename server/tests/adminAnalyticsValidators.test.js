const {
  adminAnalyticsAnomalySchema,
  adminAnalyticsExportSchema,
  adminAnalyticsOverviewSchema,
  adminAnalyticsTimeSeriesSchema,
} = require('../validators/adminAnalyticsValidators');

describe('adminAnalyticsValidators ranges and datasets', () => {
  test('overview accepts fixed ranges', () => {
    expect(() => adminAnalyticsOverviewSchema.parse({ query: { range: '7d' } })).not.toThrow();
    expect(adminAnalyticsOverviewSchema.safeParse({ query: { range: 'decade' } }).success).toBe(false);
  });

  test('time series scope granularity', () => {
    expect(() => adminAnalyticsTimeSeriesSchema.parse({ query: { range: '30d', granularity: 'day' } })).not.toThrow();
    expect(adminAnalyticsTimeSeriesSchema.safeParse({ query: { granularity: 'fortnight' } }).success).toBe(false);
  });

  test('anomaly windows stay within 15..240 minutes', () => {
    expect(() => adminAnalyticsAnomalySchema.parse({ query: { windowMinutes: '60' } })).not.toThrow();
    expect(adminAnalyticsAnomalySchema.safeParse({ query: { windowMinutes: '5' } }).success).toBe(false);
  });

  test('exports bound datasets and row counts', () => {
    expect(() => adminAnalyticsExportSchema.parse({ query: { dataset: 'orders', limit: '500' } })).not.toThrow();
    expect(adminAnalyticsExportSchema.safeParse({ query: { dataset: 'secrets' } }).success).toBe(false);
    expect(adminAnalyticsExportSchema.safeParse({ query: { limit: '99999' } }).success).toBe(false);
  });
});
