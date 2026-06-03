import path from 'node:path';
import {
  buildTrafficResilienceMatrixReport,
  parseTrafficArgs,
  renderMatrixSections,
  renderTrafficReportMarkdown,
  writeTrafficReport,
} from './traffic-fortress-utils.mjs';

const options = parseTrafficArgs(process.argv.slice(2));
const report = buildTrafficResilienceMatrixReport(options);
const markdown = renderTrafficReportMarkdown(report, renderMatrixSections(report.rows));
const written = writeTrafficReport({
  report,
  markdown,
  reportDir: options.reportDir,
  baseName: 'traffic-resilience-matrix',
  options,
});
console.log(`[traffic-resilience-matrix] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
