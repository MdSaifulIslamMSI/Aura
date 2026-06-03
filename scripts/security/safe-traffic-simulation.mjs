import path from 'node:path';
import {
  buildSafeTrafficSimulationReport,
  parseTrafficArgs,
  renderSimulationSections,
  renderTrafficReportMarkdown,
  writeTrafficReport,
} from './traffic-fortress-utils.mjs';

const options = parseTrafficArgs(process.argv.slice(2));
const report = buildSafeTrafficSimulationReport(options);
const markdown = renderTrafficReportMarkdown(report, renderSimulationSections(report));
const written = writeTrafficReport({
  report,
  markdown,
  reportDir: options.reportDir,
  baseName: 'safe-traffic-simulation',
  options,
});
console.log(`[safe-traffic-simulation] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
