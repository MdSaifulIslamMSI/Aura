const {
  createCatalogImportSchema,
  createCatalogSyncRunSchema,
  getCatalogImportSchema,
  publishCatalogImportSchema,
  validateCatalogOnboardingSchema,
} = require('../validators/catalogValidators');

describe('catalogValidators imports', () => {
  test('create accepts snapshot import manifests', () => {
    expect(() => createCatalogImportSchema.parse({
      body: { sourceType: 'jsonl', sourceRef: 's3://bucket/snap.jsonl', manifestRef: 's3://bucket/m.json' },
    })).not.toThrow();
  });

  test('rejects unknown source types and oversized refs', () => {
    expect(createCatalogImportSchema.safeParse({
      body: { sourceType: 'parquet', sourceRef: 'x' },
    }).success).toBe(false);
    expect(createCatalogImportSchema.safeParse({
      body: { sourceType: 'csv', sourceRef: 'x'.repeat(600) },
    }).success).toBe(false);
  });

  test('publish requires explicit confirmation (destructive guard)', () => {
    expect(() => publishCatalogImportSchema.parse({ params: { jobId: 'job-1' }, body: { confirm: true } })).not.toThrow();
    expect(publishCatalogImportSchema.safeParse({ params: { jobId: 'job-1' }, body: { confirm: false } }).success).toBe(false);
    expect(publishCatalogImportSchema.safeParse({ params: { jobId: 'job-1' }, body: {} }).success).toBe(false);
  });

  test('job lookups validate ids', () => {
    expect(() => getCatalogImportSchema.parse({ params: { jobId: 'job-1' } })).not.toThrow();
    expect(getCatalogImportSchema.safeParse({ params: { jobId: '' } }).success).toBe(false);
  });

  test('sync runs scope providers and cursors', () => {
    expect(() => createCatalogSyncRunSchema.parse({ body: { provider: 'kaggle', cursor: 'abc' } })).not.toThrow();
    expect(createCatalogSyncRunSchema.safeParse({ body: { extra: 'x' } }).success).toBe(false);
  });

  test('onboarding validation mirrors import requirements', () => {
    expect(() => validateCatalogOnboardingSchema.parse({
      body: { sourceType: 'json', sourceRef: 's3://b/s.json' },
    })).not.toThrow();
  });
});
