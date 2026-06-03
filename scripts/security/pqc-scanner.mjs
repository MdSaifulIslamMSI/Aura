import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.conf',
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.md',
  '.nginx',
  '.ps1',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const DEFAULT_INCLUDED_PREFIXES = [
  'server/',
  'src/',
  'app/',
  'apps/',
  'packages/',
  'config/',
  'infra/',
  'scripts/',
  '.github/workflows/',
  'nginx/',
  'caddy/',
  'haproxy/',
  'Dockerfile',
];

const EXCLUDED_PARTS = new Set([
  '.git',
  '.next',
  '.run-logs',
  '.trivycache',
  '.vercel',
  '.netlify',
  'build',
  'coverage',
  'desktop-release',
  'dist',
  'generated',
  'node_modules',
  'output',
  'reports',
  'security-reports',
  'vendor',
]);

const EXCLUDED_POLICY_FILES = new Set([
  'config/security/post-quantum-policy.json',
  'config/security/pqc-allowlist.json',
  'docs/security/free-security-scanners.md',
  'docs/security/openssl-oqs-staging-lab.md',
  'docs/security/internal-service-encryption-readiness.md',
  'docs/security/post-quantum-readiness.md',
  'docs/security/pqc-backup-key-agility.md',
  'docs/security/pqc-controlled-surface-matrix.md',
  'docs/security/pqc-openssl-oqs-lab-results.md',
  'docs/security/pqc-provider-dependency-register.md',
  'docs/security/pqc-maturity-scorecard.md',
  'docs/security/pqc-production-runbook.md',
  'docs/security/pqc-release-signing-readiness.md',
  'docs/security/pqc-ssh-hardening.md',
  'docs/security/pqc-tls-edge-readiness.md',
  'docs/security/pr-pqc-real-environment-evidence-upgrade.md',
  'scripts/security/crypto-inventory.mjs',
  'scripts/security/backup-crypto-agility-check.mjs',
  'scripts/security/check-ssh-pqc-readiness.mjs',
  'scripts/security/internal-service-encryption-check.mjs',
  'scripts/security/pqc-deployment-proof.mjs',
  'scripts/security/pqc-lab-smoke.mjs',
  'scripts/security/pqc-maturity-scorecard.mjs',
  'scripts/security/pqc-policy-check.mjs',
  'scripts/security/pqc-provider-register-check.mjs',
  'scripts/security/pqc-readiness-utils.mjs',
  'scripts/security/pqc-scanner.mjs',
  'scripts/security/release-signing-readiness-check.mjs',
  'scripts/security/tls-config-readiness.mjs',
  'scripts/security/tls-endpoint-pqc-readiness.mjs',
  'scripts/security/run-free-security-stack.mjs',
  'security/semgrep/pqc-crypto-policy.yml',
]);

const LOCKFILE_PATTERN = /(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/i;
const MINIFIED_PATTERN = /\.min\.(?:js|css)$/i;
const TEST_PATH_PATTERN = /(^|\/)(?:test|tests|__tests__)(\/|$)|\.test\.[cm]?[jt]sx?$/i;
const MAX_FILE_BYTES = 2_000_000;

export const FINDING_RULES = [
  {
    severity: 'BLOCKER',
    category: 'RSA_APPLICATION_ENCRYPTION_PUBLIC',
    regex: /\b(?:crypto\s*\.\s*)?publicEncrypt\s*\(/gi,
    recommendation: 'Do not add RSA application payload encryption. Use protocol-level TLS 1.3 and track hybrid ML-KEM migration through the PQC policy.',
  },
  {
    severity: 'BLOCKER',
    category: 'RSA_APPLICATION_ENCRYPTION_PRIVATE',
    regex: /\b(?:crypto\s*\.\s*)?privateDecrypt\s*\(/gi,
    recommendation: 'Do not add RSA privateDecrypt application payload paths. Keep production crypto standards-aligned and config-driven.',
  },
  {
    severity: 'BLOCKER',
    category: 'CUSTOM_DH_KEY_EXCHANGE',
    regex: /\bcreateDiffieHellman\s*\(|\bdiffieHellman\s*\(/gi,
    recommendation: 'Avoid custom DH key exchange. Prefer TLS 1.3 and staging-only hybrid PQC experiments.',
  },
  {
    severity: 'BLOCKER',
    category: 'CUSTOM_ECDH_KEY_EXCHANGE',
    regex: /\bcreateECDH\s*\(|\bECDH\b/g,
    recommendation: 'Avoid custom ECDH key exchange. Use standards-backed TLS and crypto-agility policy controls.',
  },
  {
    severity: 'BLOCKER',
    category: 'TLS_V1_0_ENABLED',
    regex: /\bTLSv1(?:\.0)?\b(?!\.\d)/gi,
    recommendation: 'Disable TLS 1.0 and require TLS 1.3 where compatible.',
  },
  {
    severity: 'BLOCKER',
    category: 'TLS_V1_1_ENABLED',
    regex: /\bTLSv1\.1\b/gi,
    recommendation: 'Disable TLS 1.1 and require TLS 1.3 where compatible.',
  },
  {
    severity: 'BLOCKER',
    category: 'SSL_V2_ENABLED',
    regex: /\bSSLv2\b/gi,
    recommendation: 'Remove SSLv2 references from executable configuration.',
  },
  {
    severity: 'BLOCKER',
    category: 'SSL_V3_ENABLED',
    regex: /\bSSLv3\b/gi,
    recommendation: 'Remove SSLv3 references from executable configuration.',
  },
  {
    severity: 'BLOCKER',
    category: 'MD5_USAGE',
    regex: /\bMD5\b|\bmd5\b/g,
    recommendation: 'Do not add MD5 usage. Use modern integrity/signature primitives and document any legacy exception with an expiring allowlist.',
  },
  {
    severity: 'BLOCKER',
    category: 'SHA1_SIGNATURE_OR_INTEGRITY',
    regex: /\bSHA1\b|\bsha1\b|\bsha-1\b/gi,
    recommendation: 'Do not add SHA1 for signatures or integrity. Use SHA-256 or stronger where hashing is required.',
  },
  {
    severity: 'BLOCKER',
    category: 'HARDCODED_PRIVATE_KEY',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    recommendation: 'Remove hardcoded private key material and load secrets from approved runtime secret storage.',
  },
  {
    severity: 'WARNING',
    category: 'RSA_CLASSICAL_SIGNATURE',
    regex: /\bRSA\b|\bRS256\b|\bPS256\b/g,
    recommendation: 'Classical RSA signatures may remain for ecosystem compatibility, but track migration and avoid long-lived keys.',
  },
  {
    severity: 'WARNING',
    category: 'ECDSA_CLASSICAL_SIGNATURE',
    regex: /\bECDSA\b|\bES256\b/g,
    recommendation: 'Classical ECDSA signatures may remain for ecosystem compatibility, but track migration and avoid long-lived keys.',
  },
  {
    severity: 'WARNING',
    category: 'ED25519_CLASSICAL_SIGNATURE',
    regex: /\bEd25519\b/gi,
    recommendation: 'Ed25519 remains strong classically but is not post-quantum. Track signature migration when ecosystem support is ready.',
  },
  {
    severity: 'WARNING',
    category: 'NODE_CREATE_SIGN',
    regex: /\bcreateSign\s*\(/g,
    recommendation: 'Review signing usage for key lifetime, algorithm choice, and future PQ signature migration.',
  },
  {
    severity: 'WARNING',
    category: 'NODE_CREATE_VERIFY',
    regex: /\bcreateVerify\s*\(/g,
    recommendation: 'Review verification usage for algorithm agility and ecosystem migration readiness.',
  },
  {
    severity: 'WARNING',
    category: 'NODE_GENERATE_KEY_PAIR',
    regex: /\bgenerateKeyPair(?:Sync)?\s*\(/g,
    recommendation: 'Ensure generated keys are rotatable, short-lived where possible, and tracked in the PQC migration inventory.',
  },
  {
    severity: 'WARNING',
    category: 'JWT_CLASSICAL_SIGNATURE',
    regex: /\bjwt\.sign\s*\(|\bRS256\b|\bES256\b|\bPS256\b/g,
    recommendation: 'JWT signing is ecosystem-dependent today. Keep tokens short-lived and track PQ signature support.',
  },
  {
    severity: 'WARNING',
    category: 'JWKS_CLASSICAL_KEYSET',
    regex: /\bjwks\b|\bJWKS\b/g,
    recommendation: 'JWKS is generally classical today. Track issuer/provider PQ signature support.',
  },
  {
    severity: 'WARNING',
    category: 'X509_CERTIFICATE',
    regex: /\bx509\b|\bX\.509\b/gi,
    recommendation: 'Review certificate lifetime, rotation, and WebPKI ecosystem readiness before PQ certificate migration.',
  },
  {
    severity: 'WARNING',
    category: 'CERTIFICATE_PINNING',
    regex: /certificate pinning|pin-sha256|public key pinning/gi,
    recommendation: 'Certificate pinning can slow migration. Ensure pins are rotatable and documented.',
  },
  {
    severity: 'WARNING',
    category: 'LONG_LIVED_CERTIFICATE',
    regex: /long-lived certificate|certificate.*(?:365|730|1095|long-lived)/gi,
    recommendation: 'Prefer short-lived, rotatable certificates and document any exception.',
  },
  {
    severity: 'INFO',
    category: 'AES_256_GCM',
    regex: /\bAES-256-GCM\b|\baes-256-gcm\b/g,
    recommendation: 'AES-256-GCM is appropriate for post-quantum readiness when used with sound key management.',
  },
  {
    severity: 'INFO',
    category: 'CHACHA20_POLY1305',
    regex: /\bChaCha20-Poly1305\b|\bchacha20-poly1305\b/gi,
    recommendation: 'ChaCha20-Poly1305 is appropriate for post-quantum readiness when used with sound key management.',
  },
  {
    severity: 'INFO',
    category: 'PASSWORD_HASH_BCRYPT',
    regex: /\bbcrypt\b/gi,
    recommendation: 'bcrypt is allowed by policy with approved parameters and migration tracking.',
  },
  {
    severity: 'INFO',
    category: 'PASSWORD_HASH_ARGON2',
    regex: /\bargon2(?:id)?\b/gi,
    recommendation: 'argon2id is preferred for password hashing where available.',
  },
  {
    severity: 'INFO',
    category: 'PASSWORD_HASH_SCRYPT',
    regex: /\bscrypt\b/gi,
    recommendation: 'scrypt is allowed by policy when parameters are approved.',
  },
  {
    severity: 'INFO',
    category: 'CRYPTO_RANDOM_BYTES',
    regex: /\bcrypto\.randomBytes\s*\(|\brandomBytes\s*\(/g,
    recommendation: 'Cryptographic randomness is expected for key and token generation.',
  },
  {
    severity: 'INFO',
    category: 'WEBCRYPTO_RANDOM_VALUES',
    regex: /\bgetRandomValues\s*\(/g,
    recommendation: 'WebCrypto randomness is expected for browser-side nonces or keys.',
  },
  {
    severity: 'INFO',
    category: 'HMAC_SHA256',
    regex: /\bHMAC-SHA256\b|\bhmac.*sha256\b|\bsha256.*hmac\b/gi,
    recommendation: 'HMAC-SHA256 remains appropriate when keys are managed and rotated.',
  },
  {
    severity: 'INFO',
    category: 'TLS_1_3',
    regex: /\bTLS 1\.3\b|\bTLSv1\.3\b/g,
    recommendation: 'TLS 1.3 is the production-ready baseline while hybrid PQC is staged.',
  },
  {
    severity: 'INFO',
    category: 'OPENSSH_PQ_KEX',
    regex: /\bmlkem768x25519-sha256\b|\bsntrup761x25519-sha512\b|\bX25519MLKEM768\b/g,
    recommendation: 'OpenSSH hybrid PQ key exchange references are aligned with the readiness policy.',
  },
];

export const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');

const runGit = (args, cwd) => spawnSync('git', args, {
  cwd,
  encoding: 'utf8',
  shell: false,
});

const isGitRepo = (root) => runGit(['rev-parse', '--is-inside-work-tree'], root).status === 0;

const isProbablyTextFile = (file) => {
  const normalized = normalizePath(file);
  const basename = path.basename(normalized);
  if (/^(Dockerfile|Caddyfile|nginx\.conf|haproxy\.cfg)$/i.test(basename)) return true;
  const ext = path.extname(normalized).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
};

const isMarkdownFenceLine = (line) => /^```/.test(line.trim());

const markdownExecutableLines = (content) => {
  const output = [];
  let inFence = false;
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isMarkdownFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      output.push({ line, lineNumber: index + 1 });
    }
  }
  return output;
};

const shouldSkipByPart = (relativePath) => {
  const parts = normalizePath(relativePath).split('/');
  return parts.some((part) => EXCLUDED_PARTS.has(part));
};

const shouldIncludeDefault = (relativePath) => {
  const normalized = normalizePath(relativePath);
  if (EXCLUDED_POLICY_FILES.has(normalized)) return false;
  if (LOCKFILE_PATTERN.test(normalized) || MINIFIED_PATTERN.test(normalized)) return false;
  if (TEST_PATH_PATTERN.test(normalized)) return false;
  if (shouldSkipByPart(normalized)) return false;
  return DEFAULT_INCLUDED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix));
};

const enumerateGitFiles = (root, changedOnly) => {
  if (!isGitRepo(root)) return null;
  if (changedOnly) {
    const changed = runGit(['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD'], root);
    const untracked = runGit(['ls-files', '--others', '--exclude-standard'], root);
    if (changed.status !== 0 || untracked.status !== 0) return null;
    return [...new Set(`${changed.stdout || ''}\n${untracked.stdout || ''}`.split(/\r?\n/).filter(Boolean))];
  }

  const result = runGit(['ls-files', '-co', '--exclude-standard'], root);
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).filter(Boolean);
};

const enumerateRecursiveFiles = (root) => {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizePath(path.relative(root, absolute));
      if (entry.isDirectory()) {
        if (!shouldSkipByPart(relative)) walk(absolute);
        continue;
      }
      if (entry.isFile()) files.push(relative);
    }
  };
  walk(root);
  return files;
};

export const collectScanFiles = ({ root = process.cwd(), changedOnly = false } = {}) => {
  const resolvedRoot = path.resolve(root);
  if (existsSync(resolvedRoot) && statSync(resolvedRoot).isFile()) {
    return [path.basename(resolvedRoot)];
  }

  const gitFiles = enumerateGitFiles(resolvedRoot, changedOnly);
  const files = gitFiles || enumerateRecursiveFiles(resolvedRoot);
  const defaultRepoMode = existsSync(path.join(resolvedRoot, 'package.json')) || existsSync(path.join(resolvedRoot, '.git'));

  return files
    .map(normalizePath)
    .filter((file) => (defaultRepoMode ? shouldIncludeDefault(file) : !shouldSkipByPart(file)))
    .filter(isProbablyTextFile)
    .filter((file) => {
      const absolute = path.join(resolvedRoot, file);
      return existsSync(absolute) && statSync(absolute).isFile() && statSync(absolute).size <= MAX_FILE_BYTES;
    })
    .sort();
};

const scanLine = (findings, file, line, lineNumber) => {
  for (const rule of FINDING_RULES) {
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(line)) !== null) {
      findings.push({
        severity: rule.severity,
        file,
        line: lineNumber,
        match: match[0],
        category: rule.category,
        recommendation: rule.recommendation,
      });
    }
  }
};

const dedupeFindings = (findings) => {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.severity}:${finding.file}:${finding.line}:${finding.category}:${finding.match}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const scanCryptoInventory = ({ root = process.cwd(), changedOnly = false } = {}) => {
  const resolvedRoot = path.resolve(root);
  const files = collectScanFiles({ root: resolvedRoot, changedOnly });
  const findings = [];

  for (const file of files) {
    const absolute = existsSync(resolvedRoot) && statSync(resolvedRoot).isFile()
      ? resolvedRoot
      : path.join(resolvedRoot, file);

    let content;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }

    const scanLines = path.extname(file).toLowerCase() === '.md'
      ? markdownExecutableLines(content)
      : content.split(/\r?\n/).map((line, index) => ({ line, lineNumber: index + 1 }));

    for (const { line, lineNumber } of scanLines) {
      scanLine(findings, normalizePath(file), line, lineNumber);
    }
  }

  const normalizedFindings = dedupeFindings(findings).sort((a, b) => {
    const severityOrder = { BLOCKER: 0, WARNING: 1, INFO: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity]
      || a.file.localeCompare(b.file)
      || a.line - b.line
      || a.category.localeCompare(b.category);
  });

  const summary = {
    blockers: normalizedFindings.filter((finding) => finding.severity === 'BLOCKER').length,
    warnings: normalizedFindings.filter((finding) => finding.severity === 'WARNING').length,
    info: normalizedFindings.filter((finding) => finding.severity === 'INFO').length,
    filesScanned: files.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    summary,
    findings: normalizedFindings,
  };
};

export const renderInventoryMarkdown = (inventory) => {
  const rowsFor = (severity) => {
    const findings = inventory.findings.filter((finding) => finding.severity === severity);
    if (findings.length === 0) return '| Status | Detail |\n| --- | --- |\n| Clear | No findings. |';
    return [
      '| File | Line | Category | Match | Recommendation |',
      '| --- | ---: | --- | --- | --- |',
      ...findings.map((finding) => `| ${finding.file} | ${finding.line} | ${finding.category} | ${escapeMarkdown(finding.match)} | ${escapeMarkdown(finding.recommendation)} |`),
    ].join('\n');
  };

  return [
    '# Crypto Inventory',
    '',
    '## Executive summary',
    '',
    `Generated: ${inventory.generatedAt}`,
    '',
    `Scanned ${inventory.summary.filesScanned} file(s): ${inventory.summary.blockers} blocker(s), ${inventory.summary.warnings} warning(s), ${inventory.summary.info} informational finding(s).`,
    '',
    '## Blockers',
    '',
    rowsFor('BLOCKER'),
    '',
    '## Warnings',
    '',
    rowsFor('WARNING'),
    '',
    '## Info',
    '',
    rowsFor('INFO'),
    '',
    '## Recommended next actions',
    '',
    '- Fix or explicitly allowlist blockers with an owner-reviewed reason and expiry.',
    '- Track warning-class classical signatures and certificates in the PQC readiness roadmap.',
    '- Keep production changes behind existing TLS 1.3 and runtime configuration gates.',
    '',
    '## Known limitations',
    '',
    '- This is a source scanner, not a proof of cryptographic correctness.',
    '- Dependency internals, hosted-provider crypto, and runtime-only configuration still require separate review.',
    '- Markdown is scanned only inside fenced code blocks to avoid treating explanatory text as executable policy.',
    '',
  ].join('\n');
};

const escapeMarkdown = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
