import path from 'node:path';
import {
  buildRateLimitCoverageReport,
  parseTrafficArgs,
  renderTrafficReportMarkdown,
  writeTrafficReport,
} from './traffic-fortress-utils.mjs';

const options = parseTrafficArgs(process.argv.slice(2));
const report = buildRateLimitCoverageReport(options);
const markdown = renderTrafficReportMarkdown(report, [
  '## Covered Route Families',
  '',
  ...report.coveredRoutes.map((entry) => `- ${entry.name}: ${entry.file}`),
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);
const written = writeTrafficReport({
  report,
  markdown,
  reportDir: options.reportDir,
  baseName: 'rate-limit-coverage',
  options,
});
console.log(`[rate-limit-coverage] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
