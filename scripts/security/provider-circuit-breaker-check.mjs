import path from 'node:path';
import {
  buildProviderCircuitBreakerReport,
  parseTrafficArgs,
  renderTrafficReportMarkdown,
  writeTrafficReport,
} from './traffic-fortress-utils.mjs';

const options = parseTrafficArgs(process.argv.slice(2));
const report = buildProviderCircuitBreakerReport(options);
const markdown = renderTrafficReportMarkdown(report, [
  '## Providers',
  '',
  ...report.providers.map((entry) => `- ${entry.provider}: ${entry.file}`),
]);
const written = writeTrafficReport({
  report,
  markdown,
  reportDir: options.reportDir,
  baseName: 'provider-circuit-breakers',
  options,
});
console.log(`[provider-circuit-breakers] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
