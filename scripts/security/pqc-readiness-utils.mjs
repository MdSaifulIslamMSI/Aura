import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultRepoRoot = path.resolve(scriptDir, '..', '..');

export const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');

export const parseReadinessArgs = (argv, defaults = {}) => {
  const options = {
    root: defaultRepoRoot,
    reportDir: path.join(defaultRepoRoot, 'reports', 'security'),
    json: false,
    markdown: false,
    strict: false,
    ci: false,
    allowMissingSystemTools: false,
    configs: [],
    ...defaults,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.root = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--report-dir' || arg === '--reports-dir') {
      options.reportDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--config') {
      options.configs.push(path.resolve(argv[index + 1]));
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--markdown') {
      options.markdown = true;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--ci') {
      options.ci = true;
    } else if (arg === '--allow-missing-system-tools') {
      options.allowMissingSystemTools = true;
    }
  }

  if (!options.json && !options.markdown) {
    options.json = true;
    options.markdown = true;
  }

  return options;
};

export const repoPath = (root, relativePath) => path.join(root, relativePath);

export const relativeToRoot = (root, absolutePath) => normalizePath(path.relative(root, absolutePath));

export const readText = (filePath) => readFileSync(filePath, 'utf8');

export const readTextIfExists = (filePath) => (existsSync(filePath) ? readText(filePath) : '');

export const readJsonIfExists = (filePath, fallback = null) => {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readText(filePath));
};

export const escapeMarkdown = (value) => String(value || '')
  .replace(/\\/g, '\\\\')
  .replace(/\|/g, '\\|')
  .replace(/\r?\n/g, ' ');

export const markdownTable = (headers, rows) => [
  `| ${headers.map(escapeMarkdown).join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map(escapeMarkdown).join(' | ')} |`),
].join('\n');

export const commandExists = (command) => {
  const probe = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    shell: false,
    timeout: 5000,
  });
  return probe.status === 0 || Boolean(probe.stdout || probe.stderr);
};

export const runCommand = (command, args = [], options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || defaultRepoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeoutMs || 10000,
  });

  return {
    command: [command, ...args].join(' '),
    available: result.error?.code !== 'ENOENT',
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? result.error.message : '',
  };
};

export const parseVersionTuple = (value) => {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(value || ''));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
};

export const versionAtLeast = (value, minimum) => {
  const parsed = parseVersionTuple(value);
  if (!parsed) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (parsed[index] > minimum[index]) return true;
    if (parsed[index] < minimum[index]) return false;
  }
  return true;
};

export const check = ({
  id,
  title,
  status,
  scope = 'repo',
  severity = status === 'fail' ? 'high' : 'info',
  summary = '',
  evidence = {},
}) => ({
  id,
  title,
  status,
  scope,
  severity,
  summary,
  evidence,
});

export const summarizeChecks = (checks) => ({
  pass: checks.filter((entry) => entry.status === 'pass').length,
  warning: checks.filter((entry) => entry.status === 'warning').length,
  fail: checks.filter((entry) => entry.status === 'fail').length,
  skipped: checks.filter((entry) => entry.status === 'skipped').length,
});

export const shouldFail = (checks, options = {}) => {
  const repoFailures = checks.some((entry) => entry.status === 'fail' && entry.scope === 'repo');
  const policyFailures = checks.some((entry) => entry.status === 'fail' && entry.scope === 'policy');
  const systemFailures = checks.some((entry) => entry.status === 'fail' && entry.scope === 'system');
  if (repoFailures || policyFailures) return true;
  return Boolean(options.strictSystemTools && systemFailures);
};

export const renderChecksMarkdown = (report, extraSections = []) => [
  `# ${report.title}`,
  '',
  `Generated: ${report.generatedAt}`,
  '',
  `Status: ${report.status}`,
  '',
  `Summary: ${report.summary.pass} pass, ${report.summary.warning} warning, ${report.summary.fail} fail, ${report.summary.skipped} skipped.`,
  '',
  '## Checks',
  '',
  markdownTable(
    ['ID', 'Status', 'Scope', 'Severity', 'Summary'],
    report.checks.map((entry) => [entry.id, entry.status, entry.scope, entry.severity, entry.summary]),
  ),
  '',
  ...extraSections,
  '',
].join('\n');

export const writeReadinessReports = ({ report, markdown, reportDir, baseName, options }) => {
  mkdirSync(reportDir, { recursive: true });
  const written = [];
  if (options.json) {
    const jsonPath = path.join(reportDir, `${baseName}.json`);
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    written.push(jsonPath);
  }
  if (options.markdown) {
    const mdPath = path.join(reportDir, `${baseName}.md`);
    writeFileSync(mdPath, markdown);
    written.push(mdPath);
  }
  return written;
};

export const hasForbiddenPrivateMaterial = (root, relativeFiles) => {
  const findings = [];
  for (const relativeFile of relativeFiles) {
    const absolute = repoPath(root, relativeFile);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    const content = readText(absolute);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
      findings.push(relativeFile);
    }
  }
  return findings;
};

export const createTempDir = (prefix) => path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const safeRemove = (target) => {
  if (!target || !target.startsWith(os.tmpdir())) return;
  rmSync(target, { recursive: true, force: true });
};

export const isMainModule = (metaUrl) => metaUrl === pathToFileURL(process.argv[1] || '').href;
