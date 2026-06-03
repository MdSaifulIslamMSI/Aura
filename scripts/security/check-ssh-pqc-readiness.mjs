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
export const SSH_ENV_REPORT_BASENAME = 'ssh-pqc-environment-proof';

const disabledModes = new Set(['', '0', 'false', 'off', 'disabled', 'skip', 'skipped']);

const readArgValue = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : '';
};

const parseSshArgs = (argv) => ({
  ...parseReadinessArgs(argv),
  sshProofMode: readArgValue(argv, '--ssh-proof-mode') || readArgValue(argv, '--mode'),
  sshHost: readArgValue(argv, '--ssh-host') || readArgValue(argv, '--host'),
  sshPort: readArgValue(argv, '--ssh-port') || readArgValue(argv, '--port'),
  sshUser: readArgValue(argv, '--ssh-user') || readArgValue(argv, '--user'),
  sshExpectedKex: readArgValue(argv, '--expected-kex'),
  sshConnectProbe: readArgValue(argv, '--connect-probe'),
});

const splitList = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const truthy = (value) => /^(1|true|yes|on)$/i.test(String(value || '').trim());

const proofMode = (options, env = process.env) => String(
  options.sshProofMode
  || env.PQC_SSH_PROOF_MODE
  || env.PQC_ENV_PROOF_MODE
  || 'disabled',
).trim().toLowerCase();

const redactedSshTarget = ({ host, user, port }) => {
  if (!host) return '[not configured]';
  const userPart = user ? '[configured-user]@' : '';
  return `${userPart}[configured-host]:${port || '22'}`;
};

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

export const buildSshPqcEnvironmentProofReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const env = options.env || process.env;
  const checks = [];
  const mode = proofMode(options, env);
  const enabled = !disabledModes.has(mode);
  const host = String(options.sshHost || env.PQC_SSH_HOST || '').trim();
  const user = String(options.sshUser || env.PQC_SSH_USER || '').trim();
  const port = String(options.sshPort || env.PQC_SSH_PORT || '22').trim();
  const expectedKex = splitList(options.sshExpectedKex || env.PQC_SSH_EXPECTED_KEX)
    .concat(splitList(env.PQC_EXPECTED_HYBRID_KEX))
    .filter((entry, index, list) => list.indexOf(entry) === index);
  const expected = expectedKex.length > 0 ? expectedKex : preferredKex(root).slice(0, 1);
  const redactedTarget = redactedSshTarget({ host, user, port });
  const connectProbe = truthy(options.sshConnectProbe || env.PQC_SSH_CONNECT_PROBE);

  checks.push(check({
    id: 'ssh.environment-proof.mode',
    title: 'SSH environment proof mode is explicit',
    status: enabled ? 'pass' : 'skipped',
    scope: 'system',
    severity: enabled ? 'info' : 'medium',
    summary: enabled
      ? `SSH environment proof mode is ${mode}.`
      : 'SSH environment proof is disabled; set PQC_SSH_PROOF_MODE=staging with a redacted target to collect staging evidence.',
    evidence: { mode },
  }));

  checks.push(check({
    id: 'ssh.environment-proof.target-configured',
    title: 'SSH staging target is configured when proof mode is enabled',
    status: enabled ? (host ? 'pass' : 'fail') : 'skipped',
    scope: enabled ? 'policy' : 'system',
    severity: enabled && !host ? 'high' : 'info',
    summary: enabled
      ? (host ? `SSH target is configured as ${redactedTarget}.` : 'PQC_SSH_HOST is required for enabled SSH environment proof.')
      : 'No SSH target is required while proof mode is disabled.',
    evidence: { target: redactedTarget },
  }));

  checks.push(check({
    id: 'ssh.environment-proof.expected-kex-configured',
    title: 'Expected hybrid KEX is configured or inherited from policy',
    status: expected.length > 0 ? 'pass' : (enabled ? 'fail' : 'skipped'),
    scope: enabled ? 'policy' : 'system',
    severity: expected.length > 0 ? 'info' : 'high',
    summary: expected.length > 0
      ? 'Expected hybrid KEX list is available without printing host or key paths.'
      : 'Expected hybrid KEX list is empty.',
    evidence: { expectedHybridKeyExchange: expected },
  }));

  const kexResult = runCommand('ssh', ['-Q', 'kex'], { cwd: root, timeoutMs: 5000 });
  const supportedKex = new Set(`${kexResult.stdout}\n${kexResult.stderr}`.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean));
  const supportedExpected = expected.filter((entry) => supportedKex.has(entry));
  checks.push(check({
    id: 'ssh.environment-proof.client-supports-expected-kex',
    title: 'Local SSH client supports at least one expected hybrid KEX',
    status: supportedExpected.length > 0 ? 'pass' : (enabled ? 'fail' : 'warning'),
    scope: enabled ? 'policy' : 'system',
    severity: supportedExpected.length > 0 ? 'info' : 'medium',
    summary: supportedExpected.length > 0
      ? 'Local SSH client supports at least one expected hybrid key-exchange algorithm.'
      : 'Local SSH client does not list the expected hybrid KEX; upgrade OpenSSH before staging proof.',
    evidence: { command: 'ssh -Q kex', supportedExpected },
  }));

  if (enabled && host && expected.length > 0) {
    const target = user ? `${user}@${host}` : host;
    const dryRun = runCommand('ssh', [
      '-G',
      '-o',
      'BatchMode=yes',
      '-o',
      `KexAlgorithms=${expected.join(',')}`,
      '-p',
      port,
      target,
    ], { cwd: root, timeoutMs: 5000 });
    checks.push(check({
      id: 'ssh.environment-proof.client-config-dry-run',
      title: 'SSH client accepts the configured hybrid KEX preference',
      status: dryRun.available && dryRun.status === 0 ? 'pass' : 'fail',
      scope: 'policy',
      severity: dryRun.available && dryRun.status === 0 ? 'info' : 'high',
      summary: dryRun.available && dryRun.status === 0
        ? `SSH client dry-run accepted the redacted target ${redactedTarget}.`
        : `SSH client dry-run rejected the configured KEX for ${redactedTarget}.`,
      evidence: { target: redactedTarget, status: dryRun.status },
    }));
  } else {
    checks.push(check({
      id: 'ssh.environment-proof.client-config-dry-run',
      title: 'SSH client config dry-run is skipped without enabled target proof',
      status: 'skipped',
      scope: 'system',
      severity: 'info',
      summary: 'Client dry-run is skipped until proof mode and target are configured.',
      evidence: { target: redactedTarget },
    }));
  }

  if (enabled && host && connectProbe) {
    const target = user ? `${user}@${host}` : host;
    const connectResult = runCommand('ssh', [
      '-vvv',
      '-o',
      'BatchMode=yes',
      '-o',
      'NumberOfPasswordPrompts=0',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ConnectTimeout=5',
      '-o',
      `KexAlgorithms=${expected.join(',')}`,
      '-p',
      port,
      target,
      'true',
    ], { cwd: root, timeoutMs: 10000 });
    checks.push(check({
      id: 'ssh.environment-proof.readonly-connect-probe',
      title: 'Optional read-only SSH connect probe succeeds when explicitly enabled',
      status: connectResult.available && connectResult.status === 0 ? 'pass' : 'fail',
      scope: 'policy',
      severity: connectResult.available && connectResult.status === 0 ? 'info' : 'high',
      summary: connectResult.available && connectResult.status === 0
        ? `Read-only SSH connect probe succeeded for ${redactedTarget}.`
        : `Read-only SSH connect probe did not complete for ${redactedTarget}; keep production unchanged until staging is proven.`,
      evidence: { target: redactedTarget, status: connectResult.status, command: 'ssh -vvv [redacted-target] true' },
    }));
  } else {
    checks.push(check({
      id: 'ssh.environment-proof.readonly-connect-probe',
      title: 'Optional read-only SSH connect probe is explicitly disabled',
      status: 'skipped',
      scope: 'system',
      severity: 'info',
      summary: 'The probe does not open a remote SSH session unless PQC_SSH_CONNECT_PROBE=true.',
      evidence: { target: redactedTarget, enabled: connectProbe },
    }));
  }

  const summary = summarizeChecks(checks);
  return {
    title: 'OpenSSH PQC Environment Proof',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    mode,
    target: redactedTarget,
    expectedHybridKeyExchange: expected,
    summary,
    checks,
    limitations: [
      'Disabled mode is an honest no-live-target report, not proof of remote SSH readiness.',
      'SSH hostnames, usernames, key paths, and command output are redacted from evidence.',
      'A connect probe is read-only and opt-in; production SSH changes still require explicit approval.',
    ],
  };
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

export const renderSshPqcEnvironmentProofMarkdown = (report) => renderChecksMarkdown(report, [
  '## Environment Proof Target',
  '',
  `- Mode: ${report.mode}`,
  `- Target: ${report.target}`,
  '',
  '## Expected Hybrid KEX',
  '',
  ...report.expectedHybridKeyExchange.map((entry) => `- ${entry}`),
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = () => {
  const options = parseSshArgs(process.argv.slice(2));
  const report = buildSshPqcReadinessReport(options);
  const environmentProof = buildSshPqcEnvironmentProofReport(options);
  const markdown = renderSshPqcReadinessMarkdown(report);
  const written = [
    ...writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: SSH_REPORT_BASENAME,
    options,
    }),
    ...writeReadinessReports({
      report: environmentProof,
      markdown: renderSshPqcEnvironmentProofMarkdown(environmentProof),
      reportDir: options.reportDir,
      baseName: SSH_ENV_REPORT_BASENAME,
      options,
    }),
  ];
  console.log(`[ssh-pqc-readiness] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail' || environmentProof.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  main();
}
