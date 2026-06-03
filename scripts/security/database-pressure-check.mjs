import path from 'node:path';
import {
  buildDatabasePressureReport,
  parseTrafficArgs,
  renderTrafficReportMarkdown,
  writeTrafficReport,
} from './traffic-fortress-utils.mjs';

const options = parseTrafficArgs(process.argv.slice(2));
const report = buildDatabasePressureReport(options);
const markdown = renderTrafficReportMarkdown(report);
const written = writeTrafficReport({
  report,
  markdown,
  reportDir: options.reportDir,
  baseName: 'database-pressure-resilience',
  options,
});
console.log(`[database-pressure] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
