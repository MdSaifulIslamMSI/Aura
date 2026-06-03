import path from 'node:path';
import {
  buildBackpressureReadinessReport,
  parseTrafficArgs,
  renderTrafficReportMarkdown,
  writeTrafficReport,
} from './traffic-fortress-utils.mjs';

const options = parseTrafficArgs(process.argv.slice(2));
const report = buildBackpressureReadinessReport(options);
const markdown = renderTrafficReportMarkdown(report);
const written = writeTrafficReport({
  report,
  markdown,
  reportDir: options.reportDir,
  baseName: 'backpressure-readiness',
  options,
});
console.log(`[backpressure-readiness] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
