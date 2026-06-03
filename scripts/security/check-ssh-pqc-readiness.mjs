import path from 'node:path';
import {
  check,
  defaultRepoRoot,
  isMainModule,
  parseReadinessArgs,
  readJsonIfExists,
  readTextIfExists,
  renderChecksMarkdown,
  repoPath,
  runCommand,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';

export const SSH_REPORT_BASENAME = 'ssh-pqc-readiness';

const preferredKex = (root) => {
  const policy = readJsonIfExists(repoPath(root, 'config/security/post-quantum-policy.json'), {});
  return Array.isArray(policy.preferredHybridKeyExchange)
    ? policy.preferredHybridKeyExchange.filter((entry) => /mlkem|sntrup/i.test(entry))
      .filter((entry) => /sha/i.test(entry))
    : ['mlkem768x25519-sha256', 'sntrup761x25519-sha512'];
};

export const buildSshPqcReadinessReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];
  const preferred = preferredKex(root);
  const docs = {
    hardening: 'docs/security/pqc-ssh-hardening.md',
    serverConfig: 'infra/security/sshd_config.pqc.example',
    clientConfig: 'infra/security/ssh_config.pqc.example',
  };

  for (const [key, relativeFile] of Object.entries(docs)) {
    const content = readTextIfExists(repoPath(root, relativeFile));
    checks.push(check({
      id: `repo.${key}`,
      title: `${key} evidence exists`,
      status: content ? 'pass' : 'fail',
      scope: 'repo',
      severity: content ? 'info' : 'high',
      summary: content ? `${relativeFile} exists.` : `${relativeFile} is missing.`,
      evidence: { file: relativeFile },
    }));
  }

  const hardeningDoc = readTextIfExists(repoPath(root, docs.hardening));
  checks.push(check({
    id: 'repo.rollback-documented',
    title: 'SSH rollback is documented',
    status: /rollback/i.test(hardeningDoc) && /console/i.test(hardeningDoc) ? 'pass' : 'fail',
    scope: 'repo',
    severity: 'medium',
    summary: 'SSH hardening runbook includes emergency console rollback.',
    evidence: { file: docs.hardening },
  }));

  const sshdConfig = readTextIfExists(repoPath(root, docs.serverConfig));
  const sshConfig = readTextIfExists(repoPath(root, docs.clientConfig));
  const configText = `${sshdConfig}\n${sshConfig}`;
  for (const kex of preferred) {
    checks.push(check({
      id: `repo.kex.${kex}`,
      title: `${kex} is represented in SSH templates`,
      status: configText.includes(kex) ? 'pass' : 'fail',
      scope: 'repo',
      severity: configText.includes(kex) ? 'info' : 'medium',
      summary: configText.includes(kex)
        ? `${kex} is present in the PQ SSH examples.`
        : `${kex} is missing from the PQ SSH examples.`,
      evidence: { files: [docs.serverConfig, docs.clientConfig] },
    }));
  }

  checks.push(check({
    id: 'repo.root-login-disabled',
    title: 'Root login is disabled in server template',
    status: /PermitRootLogin\s+no/i.test(sshdConfig) ? 'pass' : 'fail',
    scope: 'repo',
    severity: 'medium',
    summary: 'The safe server example disables direct root login.',
    evidence: { file: docs.serverConfig },
  }));

  checks.push(check({
    id: 'repo.interactive-password-disabled',
    title: 'Interactive password login is disabled in server template',
    status: /PasswordAuthentication\s+no/i.test(sshdConfig) ? 'pass' : 'fail',
    scope: 'repo',
    severity: 'medium',
    summary: 'The safe server example disables interactive password login.',
    evidence: { file: docs.serverConfig },
  }));

  const sshVersion = runCommand('ssh', ['-V'], { cwd: root, timeoutMs: 5000 });
  checks.push(check({
    id: 'system.ssh-version',
    title: 'Local ssh client is available',
    status: sshVersion.available ? 'pass' : 'warning',
    scope: 'system',
    severity: sshVersion.available ? 'info' : 'medium',
    summary: sshVersion.available
      ? `ssh is available (${sshVersion.stderr || sshVersion.stdout || 'version output unavailable'}).`
      : 'ssh is not available on this machine; repo evidence is still checked.',
    evidence: {
      command: sshVersion.command,
      available: sshVersion.available,
      output: sshVersion.stderr || sshVersion.stdout,
    },
  }));

  const kexResult = runCommand('ssh', ['-Q', 'kex'], { cwd: root, timeoutMs: 5000 });
  const supportedKex = new Set(`${kexResult.stdout}\n${kexResult.stderr}`.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean));
  checks.push(check({
    id: 'system.ssh-kex-query',
    title: 'Local ssh KEX query is available',
    status: kexResult.available && kexResult.status === 0 ? 'pass' : 'warning',
    scope: 'system',
    severity: kexResult.available && kexResult.status === 0 ? 'info' : 'medium',
    summary: kexResult.available && kexResult.status === 0
      ? `ssh reports ${supportedKex.size} key-exchange algorithm(s).`
      : 'ssh key-exchange query is unavailable or failed on this machine.',
    evidence: {
      command: kexResult.command,
      available: kexResult.available,
      status: kexResult.status,
    },
  }));

  for (const kex of preferred) {
    checks.push(check({
      id: `system.supports.${kex}`,
      title: `Local ssh supports ${kex}`,
      status: supportedKex.has(kex) ? 'pass' : 'warning',
      scope: 'system',
      severity: supportedKex.has(kex) ? 'info' : 'medium',
      summary: supportedKex.has(kex)
        ? `${kex} is available locally.`
        : `${kex} is not available locally; upgrade server/client OpenSSH where supported.`,
      evidence: { command: kexResult.command },
    }));
  }

  const summary = summarizeChecks(checks);
  const report = {
    title: 'OpenSSH PQC Readiness',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    preferredHybridKeyExchange: preferred,
    summary,
    checks,
    limitations: [
      'Local OpenSSH support is machine-dependent and does not prove remote server readiness.',
      'The repo templates are examples and must be staged before production rollout.',
    ],
  };

  return report;
};

export const renderSshPqcReadinessMarkdown = (report) => renderChecksMarkdown(report, [
  '## Preferred Hybrid KEX',
  '',
  ...report.preferredHybridKeyExchange.map((entry) => `- ${entry}`),
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = buildSshPqcReadinessReport(options);
  const markdown = renderSshPqcReadinessMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: SSH_REPORT_BASENAME,
    options,
  });
  console.log(`[ssh-pqc-readiness] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  main();
}
