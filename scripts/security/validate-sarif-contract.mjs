import fs from 'node:fs';
import path from 'node:path';
import { extractJsonReport } from './report-utils.mjs';

const repoRoot = process.cwd();
const failures = [];

const read = (relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath}: file is missing`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
};

const expectIncludes = (name, content, needles) => {
  const missing = needles.filter((needle) => !content.includes(needle));
  if (missing.length > 0) {
    failures.push(`${name}: missing ${missing.join(', ')}`);
  }
};

const codeqlWorkflow = read('.github/workflows/codeql.yml');
const securityGatesWorkflow = read('.github/workflows/security-gates.yml');
const securityWorkflow = read('.github/workflows/security.yml');
const dependabot = read('.github/dependabot.yml');
const dockerRunner = read('scripts/security/run-docker-tool.mjs');

expectIncludes('CodeQL advanced setup', codeqlWorkflow, [
  '- javascript-typescript',
  '- actions',
  'queries: security-and-quality',
  'category: "/language:${{ matrix.language }}"',
]);

expectIncludes('Gitleaks SARIF output', dockerRunner, [
  "reportFormat: 'sarif'",
  "reportPath: 'gitleaks-report.sarif'",
]);

expectIncludes('Semgrep SARIF output', dockerRunner, [
  "'--sarif-output', '/src/security-reports/semgrep-report.sarif'",
]);

expectIncludes('Trivy SARIF outputs', dockerRunner, [
  "'--output', '/project/security-reports/trivy-fs.sarif'",
  "'--output', '/project/security-reports/trivy-image.sarif'",
  "'--output', '/project/security-reports/trivy-image.json'",
]);

expectIncludes('Checkov SARIF output', dockerRunner, [
  "const checkovSarifReport = path.join(reportDir, 'checkov-report.sarif')",
  "const checkovDefaultSarifReport = path.join(reportDir, 'results.sarif')",
  "'--output', 'sarif'",
  "'-w', '/reports'",
  'fs.renameSync(checkovDefaultSarifReport, checkovSarifReport)',
  'jsonOnly: true',
]);

expectIncludes('Security gate SARIF uploads', securityGatesWorkflow, [
  'github/codeql-action/upload-sarif@v4',
  'sarif_file: security-reports/gitleaks-report.sarif',
  'category: gitleaks',
  'sarif_file: security-reports/semgrep-report.sarif',
  'category: semgrep',
  'sarif_file: security-reports/trivy-fs.sarif',
  'category: trivy-filesystem',
  'sarif_file: security-reports/checkov-report.sarif',
  'category: checkov',
]);

expectIncludes('Trivy image SARIF upload', securityWorkflow, [
  'sarif_file: security-reports/trivy-image.sarif',
  'category: trivy-image',
]);

expectIncludes('Dependency review high-risk gate', securityGatesWorkflow, [
  'uses: actions/dependency-review-action@v4',
  'fail-on-severity: high',
]);

expectIncludes('Dependabot update coverage', dependabot, [
  'package-ecosystem: npm',
  '- /app',
  '- /server',
  'package-ecosystem: github-actions',
  'package-ecosystem: docker',
]);

const bannerPrefixedSarif = extractJsonReport('Checkov banner\n_ scanner _\n{"version":"2.1.0","runs":[]}\n');
if (JSON.parse(bannerPrefixedSarif).version !== '2.1.0') {
  failures.push('Checkov SARIF sanitization: banner-prefixed JSON was not preserved');
}

if (failures.length > 0) {
  console.error('[security:sarif-contract] Contract validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[security:sarif-contract] CodeQL, Gitleaks, Semgrep, Trivy, Checkov, Dependency Review, and Dependabot wiring verified.');
