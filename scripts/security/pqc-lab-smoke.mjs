import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  check,
  createTempDir,
  defaultRepoRoot,
  isMainModule,
  parseReadinessArgs,
  readTextIfExists,
  renderChecksMarkdown,
  repoPath,
  runCommand,
  safeRemove,
  shouldFail,
  summarizeChecks,
  versionAtLeast,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';

export const PQC_LAB_REPORT_BASENAME = 'pqc-lab-smoke';
export const PQC_LAB_BENCHMARK_REPORT_BASENAME = 'pqc-lab-benchmark';

const labFiles = [
  'docs/security/pqc-openssl-oqs-lab-results.md',
  'infra/labs/pqc/README.md',
  'infra/labs/pqc/docker-compose.yml',
  'infra/labs/pqc/openssl-35.Dockerfile',
];

const repoLabPrivateMaterialPattern = /\.(?:key|pem|crt|csr|p12|pfx)$/i;

const outputIncludes = (result, pattern) => pattern.test(`${result.stdout}\n${result.stderr}`);

const attemptSampleGeneration = (root, algorithm) => {
  const tempDir = createTempDir('aura-pqc-lab');
  mkdirSync(tempDir, { recursive: true });
  const outputFile = path.join(tempDir, `${algorithm.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pem`);
  const result = runCommand('openssl', ['genpkey', '-algorithm', algorithm, '-out', outputFile], {
    cwd: root,
    timeoutMs: 10000,
  });
  const generated = existsSync(outputFile);
  safeRemove(tempDir);
  return {
    attempted: true,
    algorithm,
    status: result.status,
    available: result.available,
    generated,
  };
};

export const buildPqcLabSmokeReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];

  for (const relativeFile of labFiles) {
    const content = readTextIfExists(repoPath(root, relativeFile));
    checks.push(check({
      id: `repo.lab-file.${relativeFile}`,
      title: `${relativeFile} exists`,
      status: content ? 'pass' : 'fail',
      scope: 'repo',
      severity: content ? 'info' : 'high',
      summary: content ? `${relativeFile} exists.` : `${relativeFile} is missing.`,
      evidence: { file: relativeFile },
    }));
  }

  const labDir = repoPath(root, 'infra/labs/pqc');
  const committedLabMaterial = existsSync(labDir)
    ? readdirSync(labDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && repoLabPrivateMaterialPattern.test(entry.name))
      .map((entry) => `infra/labs/pqc/${entry.name}`)
    : [];
  checks.push(check({
    id: 'repo.lab.no-generated-key-material',
    title: 'PQC lab directory has no generated key or cert artifacts',
    status: committedLabMaterial.length === 0 ? 'pass' : 'fail',
    scope: 'repo',
    severity: committedLabMaterial.length === 0 ? 'info' : 'critical',
    summary: committedLabMaterial.length === 0
      ? 'No generated key/certificate artifacts are present in the repo lab directory.'
      : `Generated key/certificate artifacts are present: ${committedLabMaterial.join(', ')}.`,
    evidence: { directory: 'infra/labs/pqc' },
  }));

  const opensslVersion = runCommand('openssl', ['version', '-a'], { cwd: root, timeoutMs: 10000 });
  checks.push(check({
    id: 'system.openssl.available',
    title: 'System OpenSSL is available',
    status: opensslVersion.available && opensslVersion.status === 0 ? 'pass' : 'warning',
    scope: 'system',
    severity: opensslVersion.available && opensslVersion.status === 0 ? 'info' : 'medium',
    summary: opensslVersion.available && opensslVersion.status === 0
      ? 'System OpenSSL version query succeeded.'
      : 'System OpenSSL is unavailable or failed locally; use the lab container.',
    evidence: { command: opensslVersion.command, output: opensslVersion.stdout.split(/\r?\n/)[0] || opensslVersion.stderr.split(/\r?\n/)[0] || '' },
  }));

  checks.push(check({
    id: 'system.openssl35',
    title: 'OpenSSL 3.5+ is available locally',
    status: versionAtLeast(opensslVersion.stdout || opensslVersion.stderr, [3, 5, 0]) ? 'pass' : 'warning',
    scope: 'system',
    severity: versionAtLeast(opensslVersion.stdout || opensslVersion.stderr, [3, 5, 0]) ? 'info' : 'medium',
    summary: versionAtLeast(opensslVersion.stdout || opensslVersion.stderr, [3, 5, 0])
      ? 'Local OpenSSL meets the native standardized PQC target.'
      : 'Local OpenSSL is below 3.5 or unavailable; this is expected on many developer machines.',
    evidence: { command: opensslVersion.command },
  }));

  const kemList = runCommand('openssl', ['list', '-kem-algorithms'], { cwd: root, timeoutMs: 10000 });
  checks.push(check({
    id: 'system.openssl.kem-list',
    title: 'OpenSSL KEM listing is available',
    status: kemList.available && kemList.status === 0 ? 'pass' : 'warning',
    scope: 'system',
    severity: kemList.available && kemList.status === 0 ? 'info' : 'medium',
    summary: kemList.available && kemList.status === 0
      ? 'OpenSSL exposes KEM algorithm listing.'
      : 'OpenSSL KEM algorithm listing is unavailable locally.',
    evidence: { command: kemList.command },
  }));

  const signatureList = runCommand('openssl', ['list', '-signature-algorithms'], { cwd: root, timeoutMs: 10000 });
  const algorithmChecks = [
    ['system.openssl.ml-kem', 'ML-KEM availability', /ML-?KEM/i, kemList],
    ['system.openssl.ml-dsa', 'ML-DSA availability', /ML-?DSA/i, signatureList],
    ['system.openssl.slh-dsa', 'SLH-DSA availability', /SLH-?DSA/i, signatureList],
  ];
  for (const [id, title, pattern, result] of algorithmChecks) {
    const supported = result.available && result.status === 0 && outputIncludes(result, pattern);
    checks.push(check({
      id,
      title,
      status: supported ? 'pass' : 'warning',
      scope: 'system',
      severity: supported ? 'info' : 'medium',
      summary: supported
        ? `${title} appears in local OpenSSL output.`
        : `${title} is not exposed by local OpenSSL; use OpenSSL 3.5+ or the lab image.`,
      evidence: { command: result.command },
    }));
  }

  const sampleGeneration = outputIncludes(kemList, /ML-?KEM/i)
    ? attemptSampleGeneration(root, 'ML-KEM-768')
    : { attempted: false, algorithm: 'ML-KEM-768', generated: false };
  checks.push(check({
    id: 'system.openssl.sample-generation-temp-only',
    title: 'Sample PQC generation runs only in a temp directory',
    status: sampleGeneration.attempted
      ? (sampleGeneration.generated ? 'pass' : 'warning')
      : 'skipped',
    scope: 'system',
    severity: sampleGeneration.generated ? 'info' : 'medium',
    summary: sampleGeneration.attempted
      ? (sampleGeneration.generated
        ? 'Sample generation succeeded in an OS temp directory and was cleaned up.'
        : 'Sample generation was attempted in an OS temp directory but did not complete locally.')
      : 'Sample generation skipped because local OpenSSL did not list ML-KEM.',
    evidence: { algorithm: sampleGeneration.algorithm, attempted: sampleGeneration.attempted },
  }));

  const summary = summarizeChecks(checks);
  const report = {
    title: 'OpenSSL 3.5 / OQS PQC Lab Smoke',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    summary,
    checks,
    limitations: [
      'This lab smoke never replaces system OpenSSL and never deploys OQS/liboqs to production.',
      'OpenSSL 3.5+ native standardized algorithms are preferred where available.',
      'Local missing PQC algorithms are warnings because developer and CI runners vary.',
    ],
  };

  return report;
};

export const buildPqcLabBenchmarkReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];
  const opensslVersion = runCommand('openssl', ['version'], { cwd: root, timeoutMs: 10000 });
  const kemList = runCommand('openssl', ['list', '-kem-algorithms'], { cwd: root, timeoutMs: 10000 });
  const signatureList = runCommand('openssl', ['list', '-signature-algorithms'], { cwd: root, timeoutMs: 10000 });
  const hasMlKem = outputIncludes(kemList, /ML-?KEM/i);
  const hasMlDsa = outputIncludes(signatureList, /ML-?DSA/i);
  const hasSlhDsa = outputIncludes(signatureList, /SLH-?DSA/i);
  let sampleGeneration = { attempted: false, algorithm: 'ML-KEM-768', generated: false };
  let durationMs = null;

  checks.push(check({
    id: 'lab.benchmark.openssl-version',
    title: 'OpenSSL benchmark runtime is identified',
    status: opensslVersion.available && opensslVersion.status === 0 ? 'pass' : 'warning',
    scope: 'system',
    severity: opensslVersion.available && opensslVersion.status === 0 ? 'info' : 'medium',
    summary: opensslVersion.available && opensslVersion.status === 0
      ? 'OpenSSL version was captured for benchmark context.'
      : 'OpenSSL is unavailable locally; use the lab container for benchmark evidence.',
    evidence: { command: opensslVersion.command, version: opensslVersion.stdout || opensslVersion.stderr || '' },
  }));

  checks.push(check({
    id: 'lab.benchmark.standardized-algorithms-listed',
    title: 'Standardized PQC algorithms are listed when local OpenSSL supports them',
    status: hasMlKem || hasMlDsa || hasSlhDsa ? 'pass' : 'warning',
    scope: 'system',
    severity: hasMlKem || hasMlDsa || hasSlhDsa ? 'info' : 'medium',
    summary: hasMlKem || hasMlDsa || hasSlhDsa
      ? 'At least one standardized PQC algorithm family appears in local OpenSSL output.'
      : 'Local OpenSSL did not list ML-KEM, ML-DSA, or SLH-DSA.',
    evidence: { hasMlKem, hasMlDsa, hasSlhDsa },
  }));

  if (hasMlKem) {
    const start = performance.now();
    sampleGeneration = attemptSampleGeneration(root, 'ML-KEM-768');
    durationMs = Math.round(performance.now() - start);
  }
  checks.push(check({
    id: 'lab.benchmark.ml-kem-temp-generation',
    title: 'ML-KEM sample generation benchmark runs only in temp storage',
    status: sampleGeneration.attempted
      ? (sampleGeneration.generated ? 'pass' : 'warning')
      : 'skipped',
    scope: 'system',
    severity: sampleGeneration.generated ? 'info' : 'medium',
    summary: sampleGeneration.attempted
      ? (sampleGeneration.generated
        ? `ML-KEM sample generation completed in ${durationMs}ms and temp output was removed.`
        : 'ML-KEM sample generation was attempted in temp storage but did not complete locally.')
      : 'ML-KEM sample generation benchmark skipped because local OpenSSL did not expose ML-KEM.',
    evidence: { algorithm: sampleGeneration.algorithm, attempted: sampleGeneration.attempted, durationMs },
  }));

  const labDir = repoPath(root, 'infra/labs/pqc');
  const committedLabMaterial = existsSync(labDir)
    ? readdirSync(labDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && repoLabPrivateMaterialPattern.test(entry.name))
      .map((entry) => `infra/labs/pqc/${entry.name}`)
    : [];
  checks.push(check({
    id: 'lab.benchmark.no-generated-artifacts',
    title: 'Benchmark leaves no generated key or certificate artifacts in the repo',
    status: committedLabMaterial.length === 0 ? 'pass' : 'fail',
    scope: 'repo',
    severity: committedLabMaterial.length === 0 ? 'info' : 'critical',
    summary: committedLabMaterial.length === 0
      ? 'No generated PQC benchmark artifacts are present in the repo lab directory.'
      : `Generated lab artifacts are present: ${committedLabMaterial.join(', ')}.`,
    evidence: { directory: 'infra/labs/pqc' },
  }));

  const summary = summarizeChecks(checks);
  return {
    title: 'OpenSSL PQC Lab Benchmark',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    benchmark: {
      algorithm: sampleGeneration.algorithm,
      attempted: sampleGeneration.attempted,
      generated: sampleGeneration.generated,
      durationMs,
    },
    summary,
    checks,
    limitations: [
      'Benchmark values are local/lab context only and are not production performance claims.',
      'Missing local PQC algorithms are warnings because CI and developer OpenSSL builds vary.',
      'Generated sample material is created under the OS temp directory and removed immediately.',
    ],
  };
};

export const renderPqcLabSmokeMarkdown = (report) => renderChecksMarkdown(report, [
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

export const renderPqcLabBenchmarkMarkdown = (report) => renderChecksMarkdown(report, [
  '## Benchmark',
  '',
  `- Algorithm: ${report.benchmark.algorithm}`,
  `- Attempted: ${report.benchmark.attempted}`,
  `- Generated: ${report.benchmark.generated}`,
  `- Duration ms: ${report.benchmark.durationMs ?? 'not measured'}`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = buildPqcLabSmokeReport(options);
  const benchmarkReport = buildPqcLabBenchmarkReport(options);
  const markdown = renderPqcLabSmokeMarkdown(report);
  const written = [
    ...writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: PQC_LAB_REPORT_BASENAME,
    options,
    }),
    ...writeReadinessReports({
      report: benchmarkReport,
      markdown: renderPqcLabBenchmarkMarkdown(benchmarkReport),
      reportDir: options.reportDir,
      baseName: PQC_LAB_BENCHMARK_REPORT_BASENAME,
      options,
    }),
  ];
  console.log(`[pqc-lab-smoke] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail' || benchmarkReport.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  main();
}
