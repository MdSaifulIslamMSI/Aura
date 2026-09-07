const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_CORPUS_PATH,
  REPORT_PATH,
  loadSeededSearchCorpus,
  readLatestSearchRelevanceReport,
  writeLatestSearchRelevanceReport,
} = require('../services/searchRelevanceService');

describe('searchRelevanceService corpus and reports', () => {
  test('exposes default corpus and report paths', () => {
    expect(DEFAULT_CORPUS_PATH).toContain('search-benchmark.seeded.json');
    expect(REPORT_PATH).toContain('search-relevance.latest.json');
  });

  test('loads seeded corpora from disk', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'corpus-'));
    const file = path.join(dir, 'seed.json');
    await fs.promises.writeFile(file, JSON.stringify([{ q: 'phone' }]));
    const corpus = await loadSeededSearchCorpus(file);
    expect(corpus).toEqual([{ q: 'phone' }]);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test('coerces non-array corpora to empty lists', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'corpus-'));
    const file = path.join(dir, 'obj.json');
    await fs.promises.writeFile(file, JSON.stringify({ queries: [] }));
    await expect(loadSeededSearchCorpus(file)).resolves.toEqual([]);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test('rejects malformed corpora loudly', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'corpus-'));
    const file = path.join(dir, 'bad.json');
    await fs.promises.writeFile(file, '{not-json');
    await expect(loadSeededSearchCorpus(file)).rejects.toThrow();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test('round-trips relevance reports through custom paths', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'report-'));
    const file = path.join(dir, 'latest.json');
    const report = { generatedAt: new Date().toISOString(), score: 0.87 };
    // writeLatest ensures the default report dir as a side effect; remove it
    // afterwards when the repo does not already carry one.
    const defaultDir = path.dirname(REPORT_PATH);
    const hadDefaultDir = fs.existsSync(defaultDir);
    try {
      const returned = await writeLatestSearchRelevanceReport(report, file);
      expect(returned).toBe(file);
      await expect(readLatestSearchRelevanceReport(file)).resolves.toMatchObject({ score: 0.87 });
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
      if (!hadDefaultDir) {
        await fs.promises.rm(defaultDir, { recursive: true, force: true });
      }
    }
  });

  test('returns null for missing reports instead of throwing', async () => {
    await expect(readLatestSearchRelevanceReport(path.join(os.tmpdir(), 'no-such-report.json'))).resolves.toBeNull();
  });
});
