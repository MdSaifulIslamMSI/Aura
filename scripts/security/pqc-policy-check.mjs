import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderInventoryMarkdown, scanCryptoInventory } from './pqc-scanner.mjs';

const parseArgs = (argv) => {
  const options = {
    root: process.cwd(),
    reportDir: path.join(process.cwd(), 'reports', 'security'),
    policyPath: path.join(process.cwd(), 'config', 'security', 'post-quantum-policy.json'),
    allowlistPath: path.join(process.cwd(), 'config', 'security', 'pqc-allowlist.json'),
    changedOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.root = argv[index + 1];
      index += 1;
    }
    if (arg === '--report-dir') {
      options.reportDir = argv[index + 1];
      index += 1;
    }
    if (arg === '--policy') {
      options.policyPath = argv[index + 1];
      index += 1;
    }
    if (arg === '--allowlist') {
      options.allowlistPath = argv[index + 1];
      index += 1;
    }
    if (arg === '--changed-only') options.changedOnly = true;
  }

  return options;
};

const loadJson = (file, fallback = null) => {
  if (!existsSync(file)) {
    if (fallback !== null) return fallback;
    throw new Error(`Missing required config: ${file}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
};

const isoDateOnly = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T23:59:59.999Z`);
};

const validateAllowlist = (allowlist, now = new Date()) => {
  const entries = Array.isArray(allowlist.allowedFindings) ? allowlist.allowedFindings : [];
  const invalidEntries = [];

  for (const entry of entries) {
    if (!entry.file || !entry.category) {
      invalidEntries.push({ entry, reason: 'Allowlist entries require file and category.' });
      continue;
    }
    if (!String(entry.reason || '').trim()) {
      invalidEntries.push({ entry, reason: 'Allowlist entries require a reason.' });
    }
    const expiry = isoDateOnly(entry.expires);
    if (!expiry) {
      invalidEntries.push({ entry, reason: 'Allowlist entries require an ISO date expiry.' });
    } else if (expiry < now) {
      invalidEntries.push({ entry, reason: 'Allowlist entry has expired.' });
    }
  }

  return { entries, invalidEntries };
};

const findingMatchesEntry = (finding, entry) => (
  normalizePath(finding.file) === normalizePath(entry.file)
  && finding.category === entry.category
  && (entry.line === undefined || Number(entry.line) === Number(finding.line))
);

const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');

const isAllowlisted = (finding, entries) => entries.some((entry) => findingMatchesEntry(finding, entry));

const renderPolicyMarkdown = (report) => {
  const failureRows = report.failures.length === 0
    ? '| Status | Detail |\n| --- | --- |\n| Pass | No policy failures. |'
    : [
        '| Type | File | Line | Category | Detail |',
        '| --- | --- | ---: | --- | --- |',
        ...report.failures.map((failure) => `| ${failure.type} | ${failure.file || ''} | ${failure.line || ''} | ${failure.category || ''} | ${escapeMarkdown(failure.reason || failure.match || '')} |`),
      ].join('\n');

  const warningRows = report.warnings.length === 0
    ? '| Status | Detail |\n| --- | --- |\n| Clear | No warnings. |'
    : [
        '| File | Line | Category | Match | Recommendation |',
        '| --- | ---: | --- | --- | --- |',
        ...report.warnings.map((warning) => `| ${warning.file} | ${warning.line} | ${warning.category} | ${escapeMarkdown(warning.match)} | ${escapeMarkdown(warning.recommendation)} |`),
      ].join('\n');

  return [
    '# PQC Policy Check',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Policy version: ${report.policyVersion}`,
    '',
    `Status: ${report.status}`,
    '',
    '## Failures',
    '',
    failureRows,
    '',
    '## Warnings',
    '',
    warningRows,
    '',
    '## Inventory summary',
    '',
    `Scanned ${report.inventorySummary.filesScanned} file(s): ${report.inventorySummary.blockers} blocker(s), ${report.inventorySummary.warnings} warning(s), ${report.inventorySummary.info} informational finding(s).`,
    '',
  ].join('\n');
};

const escapeMarkdown = (value) => String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const policy = loadJson(options.policyPath);
  const allowlist = loadJson(options.allowlistPath, { allowedFindings: [] });
  const inventory = scanCryptoInventory({ root: options.root, changedOnly: options.changedOnly });
  const { entries, invalidEntries } = validateAllowlist(allowlist);

  const failures = [
    ...invalidEntries.map((invalid) => ({
      type: 'ALLOWLIST_ERROR',
      file: invalid.entry.file,
      category: invalid.entry.category,
      reason: invalid.reason,
    })),
  ];

  for (const finding of inventory.findings.filter((entry) => entry.severity === 'BLOCKER')) {
    if (!isAllowlisted(finding, entries)) {
      failures.push({
        type: 'BLOCKER',
        file: finding.file,
        line: finding.line,
        category: finding.category,
        match: finding.match,
        reason: finding.recommendation,
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    policyVersion: policy.policyVersion,
    status: failures.length === 0 ? 'pass' : 'fail',
    inventorySummary: inventory.summary,
    allowlist: {
      entries: entries.length,
      invalidEntries: invalidEntries.length,
    },
    failures,
    warnings: inventory.findings.filter((finding) => finding.severity === 'WARNING'),
    findings: inventory.findings,
  };

  mkdirSync(options.reportDir, { recursive: true });
  writeFileSync(path.join(options.reportDir, 'crypto-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  writeFileSync(path.join(options.reportDir, 'crypto-inventory.md'), renderInventoryMarkdown(inventory));
  writeFileSync(path.join(options.reportDir, 'pqc-policy-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(options.reportDir, 'pqc-policy-check.md'), renderPolicyMarkdown(report));

  console.log(`[pqc-policy] ${report.status}: ${failures.length} failure(s), ${report.warnings.length} warning(s).`);
  if (failures.length > 0) process.exit(1);
};

try {
  main();
} catch (error) {
  console.error(`[pqc-policy] ${error.message}`);
  process.exit(2);
}
