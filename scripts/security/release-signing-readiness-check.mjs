import path from 'node:path';
import {
  check,
  defaultRepoRoot,
  hasForbiddenPrivateMaterial,
  isMainModule,
  parseReadinessArgs,
  readJsonIfExists,
  readTextIfExists,
  renderChecksMarkdown,
  repoPath,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';

export const RELEASE_SIGNING_REPORT_BASENAME = 'release-signing-readiness';

const releaseDoc = 'docs/security/pqc-release-signing-readiness.md';
const workflowFiles = [
  '.github/workflows/desktop-release.yml',
  '.github/workflows/mobile-release.yml',
  '.github/workflows/security-gates.yml',
];

const mentionsAll = (content, terms) => terms.every((term) => content.toLowerCase().includes(term.toLowerCase()));

export const buildReleaseSigningReadinessReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];
  const doc = readTextIfExists(repoPath(root, releaseDoc));
  const packageJson = readJsonIfExists(repoPath(root, 'package.json'), {});
  const desktopWorkflow = readTextIfExists(repoPath(root, '.github/workflows/desktop-release.yml'));
  const mobileWorkflow = readTextIfExists(repoPath(root, '.github/workflows/mobile-release.yml'));
  const securityGates = readTextIfExists(repoPath(root, '.github/workflows/security-gates.yml'));

  checks.push(check({
    id: 'release-signing.doc.exists',
    title: 'PQC release-signing runbook exists',
    status: doc ? 'pass' : 'fail',
    scope: 'repo',
    severity: doc ? 'info' : 'high',
    summary: doc ? `${releaseDoc} exists.` : `${releaseDoc} is missing.`,
    evidence: { file: releaseDoc },
  }));

  for (const term of ['ML-DSA', 'SLH-DSA', 'No custom cryptography', 'Rollback', 'Provider/app-store compatibility']) {
    checks.push(check({
      id: `release-signing.doc.${term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `Runbook covers ${term}`,
      status: doc.toLowerCase().includes(term.toLowerCase()) ? 'pass' : 'fail',
      scope: 'repo',
      severity: doc.toLowerCase().includes(term.toLowerCase()) ? 'info' : 'medium',
      summary: doc.toLowerCase().includes(term.toLowerCase())
        ? `Release-signing runbook covers ${term}.`
        : `Release-signing runbook is missing ${term}.`,
      evidence: { file: releaseDoc },
    }));
  }

  const buildConfig = packageJson.build || {};
  checks.push(check({
    id: 'release-signing.desktop.package-config',
    title: 'Desktop package config has signature verification controls',
    status: buildConfig.win?.signAndEditExecutable === true && buildConfig.win?.verifyUpdateCodeSignature === true ? 'pass' : 'fail',
    scope: 'repo',
    severity: buildConfig.win?.signAndEditExecutable === true && buildConfig.win?.verifyUpdateCodeSignature === true ? 'info' : 'high',
    summary: 'Desktop Windows packaging keeps signing and update signature verification enabled in package metadata.',
    evidence: { file: 'package.json' },
  }));

  checks.push(check({
    id: 'release-signing.desktop.workflow-preflight',
    title: 'Desktop release workflow has explicit signing preflight',
    status: mentionsAll(desktopWorkflow, ['require_windows_signing', 'require_macos_signing', 'release-preflight']) ? 'pass' : 'fail',
    scope: 'repo',
    severity: mentionsAll(desktopWorkflow, ['require_windows_signing', 'require_macos_signing', 'release-preflight']) ? 'info' : 'high',
    summary: 'Desktop workflow requires explicit signing inputs before signed or store distribution paths.',
    evidence: { file: '.github/workflows/desktop-release.yml' },
  }));

  checks.push(check({
    id: 'release-signing.mobile.workflow-preflight',
    title: 'Mobile release workflow has explicit signing preflight',
    status: mentionsAll(mobileWorkflow, ['require_android_signing', 'require_ios_signing', 'publish_store_release']) ? 'pass' : 'fail',
    scope: 'repo',
    severity: mentionsAll(mobileWorkflow, ['require_android_signing', 'require_ios_signing', 'publish_store_release']) ? 'info' : 'high',
    summary: 'Mobile workflow requires explicit signing inputs before app-store publication paths.',
    evidence: { file: '.github/workflows/mobile-release.yml' },
  }));

  checks.push(check({
    id: 'release-signing.sbom-provenance',
    title: 'CI generates SBOM and provenance evidence',
    status: mentionsAll(securityGates, ['anchore/sbom-action', 'attest-build-provenance']) ? 'pass' : 'fail',
    scope: 'repo',
    severity: mentionsAll(securityGates, ['anchore/sbom-action', 'attest-build-provenance']) ? 'info' : 'high',
    summary: 'Security gates include SBOM generation and GitHub artifact provenance attestation.',
    evidence: { file: '.github/workflows/security-gates.yml' },
  }));

  const privateMaterialFiles = hasForbiddenPrivateMaterial(root, [releaseDoc, ...workflowFiles]);
  checks.push(check({
    id: 'release-signing.no-committed-private-material',
    title: 'Release signing docs and workflows do not commit private key material',
    status: privateMaterialFiles.length === 0 ? 'pass' : 'fail',
    scope: 'repo',
    severity: privateMaterialFiles.length === 0 ? 'info' : 'critical',
    summary: privateMaterialFiles.length === 0
      ? 'No committed private key material was found in release-signing evidence files.'
      : `Private key material appears in ${privateMaterialFiles.join(', ')}.`,
    evidence: { files: [releaseDoc, ...workflowFiles] },
  }));

  const summary = summarizeChecks(checks);
  return {
    title: 'Release Signing PQC Readiness',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    summary,
    checks,
    limitations: [
      'Current release signing remains classical because operating systems, app stores, and artifact ecosystems control accepted signature algorithms.',
      'ML-DSA and SLH-DSA signing are tracked as future migration paths, not custom application cryptography.',
      'This report verifies repo-owned release gates and docs, not live provider signing infrastructure.',
    ],
  };
};

export const renderReleaseSigningReadinessMarkdown = (report) => renderChecksMarkdown(report, [
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = buildReleaseSigningReadinessReport(options);
  const markdown = renderReleaseSigningReadinessMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: RELEASE_SIGNING_REPORT_BASENAME,
    options,
  });
  console.log(`[release-signing-readiness] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  main();
}
