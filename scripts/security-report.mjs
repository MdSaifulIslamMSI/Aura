import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

const readJson = (file, fallback = null) => {
  const absolute = path.join(reportsDir, file);
  if (!existsSync(absolute)) return fallback;
  return JSON.parse(readFileSync(absolute, 'utf8'));
};

const results = readJson('security-results.json', {
  generatedAt: new Date().toISOString(),
  categories: [],
  totalTests: 0,
});
const secretScan = readJson('secret-scan.json', null);
const dependencyAudit = readJson('dependency-audit.json', null);
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const gitDiff = spawnSync('git', ['diff', '--name-only'], {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: false,
});
const gitUntracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: false,
});
const filesChanged = Array.from(new Set(`${gitDiff.stdout || ''}\n${gitUntracked.stdout || ''}`
  .split(/\r?\n/)
  .map((file) => file.trim())
  .filter(Boolean)));

const failedCategories = (results.categories || []).filter((category) => category.status !== 'passed');
const vulnerabilities = [];
if (secretScan?.findings?.length) {
  vulnerabilities.push(`${secretScan.findings.length} secret scan finding(s)`);
}
if (dependencyAudit?.unexceptedHighOrCritical?.length) {
  vulnerabilities.push(`${dependencyAudit.unexceptedHighOrCritical.length} dependency audit finding(s)`);
}
if (failedCategories.length) {
  vulnerabilities.push(`${failedCategories.length} failed security command category/categories`);
}

const commands = [
  rootPackage.scripts?.test ? 'npm test' : 'npm --prefix server test',
  'npm run security:all',
  'npm run security:secrets',
  'npm run security:deps',
  'npm run security:tokens',
  'npm run security:idor',
  'npm run security:admin',
  'npm run security:business-logic',
  'npm run security:webhooks',
  'npm run security:cors-csrf',
  'npm run security:cloudflare',
  'npm run security:duo',
  'npm run security:logging',
];

const summary = `# Security Summary

Generated: ${new Date().toISOString()}

## Totals

- Total Jest tests parsed from security run output: ${results.totalTests || 0}
- Categories passed: ${(results.categories || []).filter((category) => category.status === 'passed').length}
- Categories failed: ${failedCategories.length}
- Secret findings: ${secretScan?.findings?.length || 0}
- Unexcepted high/critical dependency findings: ${dependencyAudit?.unexceptedHighOrCritical?.length || 0}

## Category Results

${(results.categories || []).map((category) => `- ${category.name}: ${category.status} (${category.command})`).join('\n') || '- No security runner results found yet.'}

## Vulnerabilities Found

${vulnerabilities.length ? vulnerabilities.map((item) => `- ${item}`).join('\n') : '- None reported by the local automated suite.'}

## Files Changed

${filesChanged.length ? filesChanged.map((file) => `- ${file}`).join('\n') : '- No working-tree changes detected when report was generated.'}

## Commands To Reproduce

${commands.map((command) => `- \`${command}\``).join('\n')}

## Limitations

- Automated tests verify local repository behavior only.
- Payment provider behavior is mocked with fake webhook fixtures.
- Dependency audit requires npm advisory availability.
- Edge/CDN controls such as production TLS and HSTS still need runtime verification.
- Cloudflare Turnstile and Cisco Duo live enforcement require tenant credentials and staging callback testing outside local CI.

## Recommended Manual Pentest Items

- Manual checkout abuse review against a staging environment with fake payment rails.
- Admin workflow review for last-super-admin and emergency-control governance.
- Runtime CORS/cookie/header verification behind the deployed CDN/proxy.
- Cisco Duo Universal Prompt callback and bypass-resistance testing with fake staging users.
- Focused review of seller/listing abuse paths and support/chat attachment flows.
`;

writeFileSync(path.join(reportsDir, 'security-summary.md'), summary);
writeFileSync(path.join(reportsDir, 'security-results.json'), `${JSON.stringify({
  ...results,
  generatedAt: results.generatedAt || new Date().toISOString(),
  filesChanged,
  vulnerabilities,
  secretScan: secretScan ? {
    findings: secretScan.findings?.length || 0,
    gitleaks: secretScan.gitleaks || null,
  } : null,
  dependencyAudit: dependencyAudit ? {
    unexceptedHighOrCritical: dependencyAudit.unexceptedHighOrCritical?.length || 0,
  } : null,
}, null, 2)}\n`);

console.log('Security report written to security-reports/security-summary.md and security-reports/security-results.json');
