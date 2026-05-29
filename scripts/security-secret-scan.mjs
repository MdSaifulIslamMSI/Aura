import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run secret scan with NODE_ENV=production');
}

const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: false,
  ...options,
});

const gitFiles = run('git', ['ls-files', '-co', '--exclude-standard']);
if (gitFiles.status !== 0) {
  throw new Error(`Unable to enumerate repository files: ${gitFiles.stderr || gitFiles.stdout}`);
}

const deletedTrackedFiles = new Set((run('git', ['ls-files', '--deleted']).stdout || '')
  .split(/\r?\n/)
  .map((file) => file.trim())
  .filter(Boolean));

const trackedFiles = new Set((run('git', ['ls-files']).stdout || '')
  .split(/\r?\n/)
  .map((file) => file.trim())
  .filter(Boolean)
  .filter((file) => !deletedTrackedFiles.has(file)));

const files = (gitFiles.stdout || '')
  .split(/\r?\n/)
  .map((file) => file.trim())
  .filter(Boolean)
  .filter((file) => !deletedTrackedFiles.has(file))
  .filter((file) => !/(^|\/)(node_modules|dist|build|coverage|desktop-release|\.git)(\/|$)/i.test(file.replace(/\\/g, '/')));

const textExtensions = new Set([
  '.cjs', '.css', '.env', '.example', '.html', '.js', '.json', '.jsx', '.mjs', '.md',
  '.ps1', '.sh', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);

const placeholderWords = [
  'example',
  'changeme',
  'change-me',
  'change_me',
  'dummy',
  'fake',
  'fixture',
  'local-only',
  'placeholder',
  'test',
  '<',
  '>',
];

const isPlaceholder = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  if (/^\$\{[A-Z0-9_]+\}$/i.test(normalized)) return true;
  return placeholderWords.some((word) => normalized.includes(word));
};

const redact = (value = '') => {
  const raw = String(value || '');
  if (raw.length <= 8) return '[REDACTED]';
  return `${raw.slice(0, 4)}...[REDACTED]...${raw.slice(-4)}`;
};

const addFinding = (findings, { file, line, rule, evidence, severity = 'high' }) => {
  findings.push({
    file,
    line,
    rule,
    severity,
    evidence: redact(evidence),
  });
};

const envFilePattern = /(^|\/)\.env($|\.local$|\.production$|\.staging$|\.aws-secrets$)/i;
const allowedEnvExamplePattern = /(^|\/)\.env[^/]*\.example$/i;
const sensitiveArtifactPattern = /(^|\/)(?:[^/]+\.)?(?:jks|keystore|p12|pem|key)$|(^|\/)app\/android\/ci\/.*\.base64$/i;

const findings = [];

for (const file of trackedFiles) {
  const normalized = file.replace(/\\/g, '/');
  if (envFilePattern.test(normalized) && !allowedEnvExamplePattern.test(normalized)) {
    addFinding(findings, {
      file,
      line: 1,
      rule: 'committed-env-file',
      evidence: normalized,
      severity: 'critical',
    });
  }
  if (sensitiveArtifactPattern.test(normalized)) {
    addFinding(findings, {
      file,
      line: 1,
      rule: 'committed-sensitive-artifact',
      evidence: normalized,
      severity: 'critical',
    });
  }
}

const assignmentPattern = /\b(JWT_SECRET|REFRESH_TOKEN_SECRET|MONGO_URI|DATABASE_URL|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|CLOUDINARY_API_SECRET|SMTP_PASS|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|AUTH_[A-Z0-9_]*SECRET|OTP_[A-Z0-9_]*SECRET|AI_INTERNAL_[A-Z0-9_]*SECRET|secretKey|webhookSecret|clientSecret)\b\s*[:=]\s*["'`]([^"'`\r\n]{8,})["'`]/g;

const tokenPatterns = [
  { rule: 'private-key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, severity: 'critical' },
  { rule: 'aws-access-key', regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, severity: 'critical' },
  { rule: 'aws-secret-access-key', regex: /\b[A-Za-z0-9/+=]{40}\b/g, severity: 'high', requiresContext: /AWS_SECRET_ACCESS_KEY|aws_secret_access_key/i },
  { rule: 'openai-api-key', regex: /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{24,}\b/g, severity: 'critical' },
  { rule: 'stripe-secret-key', regex: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, severity: 'critical' },
  { rule: 'raw-jwt', regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, severity: 'high' },
];

const looksText = (file) => {
  const ext = path.extname(file).toLowerCase();
  if (textExtensions.has(ext)) return true;
  return /(^|\/)(Dockerfile|Caddyfile|Fastfile|Gemfile|package-lock\.json|package\.json)$/i.test(file.replace(/\\/g, '/'));
};

const scanLine = (findingsForFile, file, lineText, lineNumber) => {
  let match;
  const normalizedFile = file.replace(/\\/g, '/');
  const isTestFixtureFile = /(^|\/)(test|tests|__tests__)(\/|$)/i.test(normalizedFile);
  assignmentPattern.lastIndex = 0;
  while ((match = assignmentPattern.exec(lineText)) !== null) {
    const [, key, value] = match;
    const rawValue = String(value || '').trim();
    const highEntropyLike = rawValue.length >= 24 || /^(sk_|sk-|rzp_live_|AKIA|ASIA)/.test(rawValue);
    const liveProviderPrefix = /^(sk_|sk-|rzp_live_|AKIA|ASIA)/.test(rawValue);
    if (isTestFixtureFile && !liveProviderPrefix) {
      continue;
    }
    if (highEntropyLike && !isPlaceholder(rawValue)) {
      addFinding(findingsForFile, {
        file,
        line: lineNumber,
        rule: `sensitive-assignment:${key}`,
        evidence: rawValue,
      });
    }
  }

  for (const pattern of tokenPatterns) {
    if (pattern.requiresContext && !pattern.requiresContext.test(lineText)) continue;
    pattern.regex.lastIndex = 0;
    while ((match = pattern.regex.exec(lineText)) !== null) {
      const value = match[0];
      if (!isPlaceholder(value)) {
        addFinding(findingsForFile, {
          file,
          line: lineNumber,
          rule: pattern.rule,
          evidence: value,
          severity: pattern.severity,
        });
      }
    }
  }
};

for (const file of files) {
  if (!looksText(file)) continue;

  const absolute = path.join(repoRoot, file);
  if (!existsSync(absolute)) continue;

  let statText;
  try {
    statText = readFileSync(absolute);
  } catch {
    continue;
  }
  if (statText.length > 2_000_000 || statText.includes(0)) continue;

  const content = statText.toString('utf8');
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    scanLine(findings, file, lines[index], index + 1);
  }
}

const gitleaksReportPath = path.join(reportsDir, 'gitleaks-report.json');
let gitleaks = { available: false, status: 'not_run' };
const gitleaksVersion = run(process.platform === 'win32' ? 'where.exe' : 'which', ['gitleaks']);
if (gitleaksVersion.status === 0) {
  const gitleaksScanRoot = mkdtempSync(path.join(os.tmpdir(), 'aura-gitleaks-'));
  for (const file of files) {
    const sourcePath = path.join(repoRoot, file);
    const destinationPath = path.join(gitleaksScanRoot, file);
    if (!existsSync(sourcePath)) continue;
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
  }

  const gitleaksArgs = [
    'detect',
    '--no-git',
    '--source',
    gitleaksScanRoot,
    '--redact',
    '--report-format',
    'json',
    '--report-path',
    gitleaksReportPath,
  ];
  const gitleaksConfigPath = path.join(repoRoot, '.gitleaks.toml');
  if (existsSync(gitleaksConfigPath)) {
    gitleaksArgs.push('--config', gitleaksConfigPath);
  }
  const gitleaksRun = run('gitleaks', gitleaksArgs);
  rmSync(gitleaksScanRoot, { recursive: true, force: true });
  gitleaks = {
    available: true,
    status: gitleaksRun.status === 0 ? 'passed' : 'failed',
    exitCode: gitleaksRun.status,
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  scanner: 'custom-secret-scan',
  gitleaks,
  scannedFiles: files.length,
  findings,
};

writeFileSync(path.join(reportsDir, 'secret-scan.json'), `${JSON.stringify(report, null, 2)}\n`);

if (findings.length > 0 || gitleaks.status === 'failed') {
  console.error(`Secret scan failed with ${findings.length} custom finding(s). Report: security-reports/secret-scan.json`);
  process.exit(1);
}

console.log(`Secret scan passed across ${files.length} repository file(s).`);
