import path from 'node:path';
import {
  buildTrafficResilienceProofReport,
  parseTrafficArgs,
  renderTrafficProofSections,
  renderTrafficReportMarkdown,
  writeTrafficReport,
} from './traffic-fortress-utils.mjs';

const options = parseTrafficArgs(process.argv.slice(2));
const report = buildTrafficResilienceProofReport(options);
const markdown = renderTrafficReportMarkdown(report, renderTrafficProofSections(report));
const written = writeTrafficReport({
  report,
  markdown,
  reportDir: options.reportDir,
  baseName: 'traffic-resilience-proof',
  options,
});
console.log(`[traffic-resilience-proof] ${report.status}: score ${report.trafficResilienceScore}% wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
