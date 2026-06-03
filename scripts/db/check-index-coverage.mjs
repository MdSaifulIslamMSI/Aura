import path from 'node:path';
import {
  check,
  defaultRepoRoot,
  isMainModule,
  parseReadinessArgs,
  readTextIfExists,
  renderChecksMarkdown,
  repoPath,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from '../security/pqc-readiness-utils.mjs';

const modelFiles = [
  'server/models/Product.js',
  'server/models/Listing.js',
  'server/models/Order.js',
  'server/models/User.js',
  'server/models/PaymentIntent.js',
];

export const buildIndexCoverageReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = modelFiles.map((file) => {
    const source = readTextIfExists(repoPath(root, file));
    const indexed = /\.index\(|index:\s*true|text:\s*['"]text['"]/i.test(source);
    return check({
      id: `db.index.${file}`,
      title: `${file} declares indexes or indexed fields`,
      status: source && indexed ? 'pass' : 'warning',
      scope: 'repo',
      severity: source && indexed ? 'info' : 'medium',
      summary: source && indexed ? `${file} includes index evidence.` : `${file} has no obvious index declaration in source.`,
      evidence: { file },
    });
  });
  checks.push(check({
    id: 'db.query-budget-guard',
    title: 'Query budget guard exists for public/search routes',
    status: readTextIfExists(repoPath(root, 'server/middleware/queryBudgetGuard.js')) ? 'pass' : 'fail',
    scope: 'repo',
    severity: 'high',
    summary: 'Route-level query budget guard rejects unbounded page sizes/search terms.',
    evidence: { file: 'server/middleware/queryBudgetGuard.js' },
  }));
  const summary = summarizeChecks(checks);
  return {
    title: 'Database Index Coverage',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    summary,
    checks,
  };
};

const main = () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = buildIndexCoverageReport(options);
  const markdown = renderChecksMarkdown(report);
  const written = writeReadinessReports({ report, markdown, reportDir: options.reportDir, baseName: 'db-index-coverage', options });
  console.log(`[db-index-coverage] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) main();
