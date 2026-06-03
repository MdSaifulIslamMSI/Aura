import path from 'node:path';
import {
  buildTrafficObservabilityReport,
  parseTrafficArgs,
  renderTrafficReportMarkdown,
  writeTrafficReport,
} from './traffic-fortress-utils.mjs';

const options = parseTrafficArgs(process.argv.slice(2));
const report = buildTrafficObservabilityReport(options);
const markdown = renderTrafficReportMarkdown(report);
const written = writeTrafficReport({
  report,
  markdown,
  reportDir: options.reportDir,
  baseName: 'traffic-observability-check',
  options,
});
console.log(`[traffic-observability] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
