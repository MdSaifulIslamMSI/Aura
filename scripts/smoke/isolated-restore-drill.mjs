#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const REPORT_BASENAME = 'isolated-backup-restore-drill';

const normalizeTargetEnvironment = (env) => String(
  env.RESTORE_TARGET_ENV
  || env.AURA_RESTORE_DRILL_ENV
  || env.NODE_ENV
  || 'development',
).trim().toLowerCase();

const normalizeForHash = (value) => {
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = normalizeForHash(value[key]);
    return acc;
  }, {});
};

const stableStringify = (value) => JSON.stringify(normalizeForHash(value));

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const buildFixtureCollections = () => ({
  users: [
    {
      _id: 'restore-drill-user-001',
      emailDigest: 'sha256:fixture-user-email',
      roles: ['buyer'],
      mfaEnabled: true,
      deletedAt: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      _id: 'restore-drill-user-002',
      emailDigest: 'sha256:fixture-admin-email',
      roles: ['admin'],
      mfaEnabled: true,
      deletedAt: null,
      updatedAt: '2026-01-01T00:01:00.000Z',
    },
  ],
  products: [
    {
      _id: 'restore-drill-product-001',
      ownerId: 'restore-drill-user-002',
      sku: 'RESTORE-DRILL-SKU-001',
      priceMinor: 199900,
      currency: 'INR',
      stock: 7,
      updatedAt: '2026-01-01T00:02:00.000Z',
    },
  ],
  orders: [
    {
      _id: 'restore-drill-order-001',
      userId: 'restore-drill-user-001',
      lineItems: [
        {
          productId: 'restore-drill-product-001',
          quantity: 1,
          priceMinor: 199900,
        },
      ],
      totalMinor: 199900,
      currency: 'INR',
      status: 'paid',
      paymentProviderRefDigest: 'sha256:fixture-provider-ref',
      updatedAt: '2026-01-01T00:03:00.000Z',
    },
  ],
  otpSessions: [
    {
      _id: 'restore-drill-otp-001',
      userId: 'restore-drill-user-001',
      otpDigest: 'sha256:fixture-expired-otp',
      consumedAt: '2026-01-01T00:04:00.000Z',
      expiresAt: '2026-01-01T00:05:00.000Z',
      restoredUsable: false,
    },
  ],
});

const collectionDigest = (documents) => sha256(documents.map(stableStringify).join('\n'));

const writeCollectionDump = (backupDir, name, documents) => {
  const lines = documents.map(stableStringify).join('\n');
  const payload = `${lines}\n`;
  writeFileSync(path.join(backupDir, `${name}.jsonl`), payload);
  return {
    name,
    count: documents.length,
    sha256: sha256(payload),
    logicalDigest: collectionDigest(documents),
  };
};

const readCollectionDump = (backupDir, name) => {
  const payload = readFileSync(path.join(backupDir, `${name}.jsonl`), 'utf8');
  return payload.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
};

const renderMarkdown = (report) => [
  '# Isolated Backup Restore Drill',
  '',
  `Generated: ${report.generatedAt}`,
  '',
  `Status: ${report.status}`,
  '',
  `Reason: ${report.reason}`,
  '',
  '## Evidence',
  '',
  `- Scope: ${report.evidence.scope}`,
  `- Production data touched: ${report.evidence.productionDataTouched}`,
  `- External commands executed: ${report.evidence.externalCommandsExecuted}`,
  `- Network used: ${report.evidence.networkUsed}`,
  `- Restore drill proven: ${report.evidence.restoreDrillProven}`,
  '',
  '## Collections',
  '',
  '| Collection | Count | Logical digest |',
  '|---|---:|---|',
  ...report.collections.map((entry) => `| ${entry.name} | ${entry.count} | ${entry.logicalDigest} |`),
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
  '',
].join('\n');

const parseArgs = (argv) => {
  const options = {
    reportDir: '',
    json: false,
    markdown: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report-dir' || arg === '--reports-dir') {
      options.reportDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--markdown') {
      options.markdown = true;
    }
  }

  return options;
};

const writeReports = (report, options) => {
  if (!options.reportDir || (!options.json && !options.markdown)) return [];
  mkdirSync(options.reportDir, { recursive: true });
  const written = [];
  if (options.json) {
    const reportPath = path.join(options.reportDir, `${REPORT_BASENAME}.json`);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    written.push(reportPath);
  }
  if (options.markdown) {
    const reportPath = path.join(options.reportDir, `${REPORT_BASENAME}.md`);
    writeFileSync(reportPath, renderMarkdown(report));
    written.push(reportPath);
  }
  return written;
};

const blockedProductionReport = (targetEnvironment) => ({
  title: 'Isolated Backup Restore Drill',
  generatedAt: new Date().toISOString(),
  status: 'fail',
  ok: false,
  blocked: true,
  reason: 'production_restore_drill_blocked',
  checks: {
    targetEnvironment,
    requiresDisposableTarget: true,
  },
  evidence: {
    scope: 'not_run',
    backupExecuted: false,
    restoreExecuted: false,
    restoreDrillProven: false,
    productionDataTouched: false,
    externalCommandsExecuted: false,
    networkUsed: false,
    temporaryWorkdirRemoved: true,
  },
  collections: [],
  limitations: [
    'Production restore drills require an explicitly approved isolated target and live backup object.',
    'This local fixture drill does not prove managed backup availability or provider retention.',
  ],
});

export const runIsolatedRestoreDrill = (options = {}) => {
  const env = options.env || process.env;
  const targetEnvironment = normalizeTargetEnvironment(env);
  if (targetEnvironment === 'production') {
    return blockedProductionReport(targetEnvironment);
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aura-restore-drill-'));
  const sourceDir = path.join(tempRoot, 'source');
  const backupDir = path.join(tempRoot, 'backup');
  const restoreDir = path.join(tempRoot, 'restore');

  try {
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(backupDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });

    const fixture = buildFixtureCollections();
    const backupManifest = Object.entries(fixture).map(([name, documents]) => {
      writeFileSync(path.join(sourceDir, `${name}.json`), `${JSON.stringify(documents, null, 2)}\n`);
      return writeCollectionDump(backupDir, name, documents);
    });

    const restoredManifest = backupManifest.map((entry) => {
      const documents = readCollectionDump(backupDir, entry.name);
      writeFileSync(path.join(restoreDir, `${entry.name}.json`), `${JSON.stringify(documents, null, 2)}\n`);
      return {
        name: entry.name,
        count: documents.length,
        logicalDigest: collectionDigest(documents),
      };
    });

    const mismatches = restoredManifest.filter((entry) => {
      const expected = backupManifest.find((candidate) => candidate.name === entry.name);
      return !expected
        || expected.count !== entry.count
        || expected.logicalDigest !== entry.logicalDigest;
    });

    const report = {
      title: 'Isolated Backup Restore Drill',
      generatedAt: new Date().toISOString(),
      status: mismatches.length === 0 ? 'pass' : 'fail',
      ok: mismatches.length === 0,
      blocked: false,
      reason: mismatches.length === 0 ? 'isolated_restore_drill_proven' : 'isolated_restore_drill_mismatch',
      checks: {
        targetEnvironment,
        fixtureCollections: backupManifest.length,
        fixtureDocuments: backupManifest.reduce((total, entry) => total + entry.count, 0),
        checksumMismatches: mismatches.map((entry) => entry.name),
        runtimeMongoUriPresent: Boolean(String(env.MONGODB_URI || env.MONGO_URI || '').trim()),
      },
      evidence: {
        scope: 'local_disposable_fixture',
        backupExecuted: true,
        restoreExecuted: true,
        restoreDrillProven: mismatches.length === 0,
        productionDataTouched: false,
        externalCommandsExecuted: false,
        networkUsed: false,
        temporaryWorkdirRemoved: true,
      },
      collections: restoredManifest,
      limitations: [
        'This drill proves backup and restore mechanics on a disposable local fixture only.',
        'It does not connect to MongoDB, decrypt real backups, verify object-store retention, or prove provider-managed backup restore.',
        'Run an approved isolated staging restore from a real backup object before claiming live backup recoverability.',
      ],
    };

    return report;
  } finally {
    if (tempRoot.startsWith(os.tmpdir()) && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const report = runIsolatedRestoreDrill();
  const written = writeReports(report, options);
  const output = written.length > 0
    ? { ...report, written: written.map((file) => path.basename(file)) }
    : report;
  console.log(JSON.stringify(output, null, 2));
  if (!report.ok) process.exitCode = 1;
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
