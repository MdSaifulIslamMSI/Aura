#!/usr/bin/env node
/**
 * Validate the runtime post-quantum configuration without starting the server.
 *
 * This script answers one question: if the service booted with this
 * environment, would every configured PQC surface be valid? It checks native
 * capability, mode values, key references, key loading/rotation, and performs
 * a small in-memory self-test. It never prints key material.
 *
 * Defaults are safe: an unconfigured deployment reports `off` and exits 0.
 * `--strict` exits nonzero on any failed check, so CI and pre-deploy gates can
 * use it directly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getPqcCapabilities } = require('../../server/security/pqc/algorithms.js');
const keyMaterial = require('../../server/security/pqc/keyMaterial.js');
const { PqcKeyRegistry, parseReferenceList } = require('../../server/security/pqc/keyRegistry.js');
const hybridKem = require('../../server/security/pqc/hybridKem.js');
const hybridSignature = require('../../server/security/pqc/hybridSignature.js');

const FIELD_MODES = new Set(['off', 'auto', 'key-wrap', 'per-record', 'require']);
const LEDGER_MODES = new Set(['off', 'auto', 'require']);

const parseArgs = (argv) => {
  const options = {
    root: process.cwd(),
    reportDir: path.join(process.cwd(), 'reports', 'security'),
    json: false,
    markdown: false,
    strict: false,
    selfTest: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.root = argv[index + 1];
      index += 1;
    } else if (arg === '--report-dir') {
      options.reportDir = argv[index + 1];
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--markdown') {
      options.markdown = true;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--no-self-test') {
      options.selfTest = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: pqc-runtime-status.mjs [--json] [--markdown] [--strict] [--no-self-test] [--root <path>] [--report-dir <path>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const readJsonIfExists = (file) => {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
};

const boolEnv = (name, fallback = false) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return /^(?:1|true|yes|on)$/i.test(String(value).trim());
};

const fieldConfig = () => ({
  enabled: boolEnv('FIELD_ENCRYPTION_ENABLED', false),
  mode: String(process.env.FIELD_ENCRYPTION_PQC_MODE || 'off').trim().toLowerCase() || 'off',
  keyRef: String(process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF || process.env.PQC_KEM_KEY_REF || '').trim(),
  previousRefs: parseReferenceList(
    process.env.FIELD_ENCRYPTION_PQC_KEM_PREVIOUS_KEY_REFS || process.env.PQC_KEM_PREVIOUS_KEY_REFS || ''
  ),
});

const ledgerConfig = () => ({
  enabled: boolEnv('SECURITY_EVENT_LEDGER_ENABLED', false),
  mode: String(process.env.SECURITY_EVENT_LEDGER_PQC_MODE || 'off').trim().toLowerCase() || 'off',
  keyRef: String(
    process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF || process.env.PQC_SIGNING_KEY_REF || ''
  ).trim(),
  previousRefs: parseReferenceList(
    process.env.SECURITY_EVENT_LEDGER_PQC_PREVIOUS_KEY_REFS || process.env.PQC_SIGNING_PREVIOUS_KEY_REFS || ''
  ),
  requiredFromSeq: String(process.env.SECURITY_EVENT_LEDGER_PQC_REQUIRED_FROM_SEQ || '').trim(),
});

const addCheck = (checks, { id, status, title, detail, evidence = null }) => {
  checks.push({ id, status, title, detail, evidence });
};

const loadSurfaceKeys = async (checks, {
  idPrefix,
  registry,
  type,
  mode,
  keyRef,
  previousRefs,
  hardModes,
  label,
}) => {
  let keyStatus = null;

  if (!keyRef) {
    if (hardModes.has(mode)) {
      addCheck(checks, {
        id: `${idPrefix}.key-ref`,
        status: 'fail',
        title: `${label} key reference is configured`,
        detail: `${label} mode "${mode}" requires a key reference.`,
      });
    } else {
      addCheck(checks, {
        id: `${idPrefix}.key-ref`,
        status: 'pass',
        title: `${label} key reference is optional`,
        detail: `Mode "${mode}" does not require key material.`,
      });
    }
    return keyStatus;
  }

  try {
    const loaded = await registry.load(type, keyRef);
    keyStatus = {
      keyId: loaded.keyId,
      algorithm: loaded.record.algorithm,
      source: loaded.source,
      hasPrivateKey: true,
      createdAt: loaded.record.createdAt || null,
    };
    addCheck(checks, {
      id: `${idPrefix}.key-load`,
      status: 'pass',
      title: `${label} key loads`,
      detail: `Loaded ${loaded.record.algorithm} key ${loaded.keyId} from ${loaded.source}.`,
      evidence: { keyId: loaded.keyId, source: loaded.source },
    });
  } catch (error) {
    addCheck(checks, {
      id: `${idPrefix}.key-load`,
      status: 'fail',
      title: `${label} key loads`,
      detail: error.message,
    });
    return keyStatus;
  }

  if (previousRefs.length) {
    try {
      const rotated = await registry.loadRotated(type, keyRef, previousRefs);
      keyStatus.previousKeys = rotated.previous.length;
      addCheck(checks, {
        id: `${idPrefix}.previous-keys`,
        status: 'pass',
        title: `${label} previous keys load`,
        detail: `Loaded ${rotated.previous.length} previous key(s) for dual-read.`,
        evidence: { previousKeys: rotated.previous.length },
      });
    } catch (error) {
      addCheck(checks, {
        id: `${idPrefix}.previous-keys`,
        status: 'fail',
        title: `${label} previous keys load`,
        detail: error.message,
      });
    }
  } else {
    keyStatus.previousKeys = 0;
  }

  return keyStatus;
};

const runSelfTest = (checks) => {
  try {
    const kemRecord = keyMaterial.generateHybridKemKey();
    const context = 'aura:pqc:runtime-status:selftest';
    const sealed = hybridKem.sealBuffer(Buffer.from('aura-pqc-runtime-selftest'), {
      publicKeyRecord: keyMaterial.toPublicRecord(kemRecord),
      context,
    });
    const opened = hybridKem.openBuffer(sealed, {
      privateKeyRecord: kemRecord,
      context,
    });
    if (opened.toString('utf8') !== 'aura-pqc-runtime-selftest') {
      throw new Error('KEM self-test plaintext mismatch');
    }
    addCheck(checks, {
      id: 'selftest.kem',
      status: 'pass',
      title: 'Hybrid KEM round-trip',
      detail: 'X25519 + ML-KEM-768 seal/open round-trip succeeded with an ephemeral key.',
    });
  } catch (error) {
    addCheck(checks, {
      id: 'selftest.kem',
      status: 'fail',
      title: 'Hybrid KEM round-trip',
      detail: error.message,
    });
  }

  try {
    const signingRecord = keyMaterial.generateHybridSigningKey();
    const context = 'aura:pqc:runtime-status:selftest';
    const message = Buffer.from('aura-pqc-runtime-selftest');
    const signed = hybridSignature.sign(message, signingRecord, { context });
    const verified = hybridSignature.verify(message, signed, keyMaterial.toPublicRecord(signingRecord), { context });
    if (!verified.valid) {
      throw new Error(`hybrid signature self-test failed to verify (${verified.reason})`);
    }
    addCheck(checks, {
      id: 'selftest.signature',
      status: 'pass',
      title: 'Hybrid signature round-trip',
      detail: 'Ed25519 + ML-DSA-65 sign/verify round-trip succeeded with an ephemeral key.',
    });
  } catch (error) {
    addCheck(checks, {
      id: 'selftest.signature',
      status: 'fail',
      title: 'Hybrid signature round-trip',
      detail: error.message,
    });
  }
};

const buildReport = async (options) => {
  const checks = [];
  const capabilities = getPqcCapabilities({ refresh: true });
  const policy = readJsonIfExists(path.join(options.root, 'config', 'security', 'post-quantum-policy.json'));
  const runtimePolicy = policy?.runtimePqc || null;
  const registry = new PqcKeyRegistry();

  addCheck(checks, {
    id: 'runtime.ml-kem',
    status: capabilities.algorithms.mlKem.available ? 'pass' : 'fail',
    title: 'ML-KEM-768 is available',
    detail: capabilities.algorithms.mlKem.available
      ? `Node ${capabilities.nodeVersion} / OpenSSL ${capabilities.opensslVersion}.`
      : capabilities.reasons.join('; '),
    evidence: { node: capabilities.nodeVersion, openssl: capabilities.opensslVersion },
  });
  addCheck(checks, {
    id: 'runtime.ml-dsa',
    status: capabilities.algorithms.mlDsa.available ? 'pass' : 'fail',
    title: 'ML-DSA-65 is available',
    detail: capabilities.algorithms.mlDsa.available
      ? `Node ${capabilities.nodeVersion} / OpenSSL ${capabilities.opensslVersion}.`
      : capabilities.reasons.join('; '),
  });
  addCheck(checks, {
    id: 'runtime.slh-dsa',
    status: capabilities.algorithms.slhDsa.available ? 'pass' : 'warn',
    title: 'SLH-DSA-SHA2-128s is available',
    detail: capabilities.algorithms.slhDsa.available
      ? 'Long-lived offline checkpoint signatures are available.'
      : capabilities.reasons.join('; '),
  });
  addCheck(checks, {
    id: 'runtime.tls-hybrid-group',
    status: capabilities.tls.available ? 'pass' : 'warn',
    title: `TLS group ${capabilities.tls.hybridGroup} is available locally`,
    detail: capabilities.tls.available
      ? 'Native OpenSSL can negotiate the hybrid TLS group; edge support is measured separately.'
      : 'Local OpenSSL cannot construct the hybrid group; edge posture is provider-dependent.',
  });

  if (runtimePolicy) {
    const defaultModeOk = runtimePolicy.defaultMode === 'off';
    addCheck(checks, {
      id: 'policy.default-mode',
      status: defaultModeOk ? 'pass' : 'fail',
      title: 'Runtime PQC default mode is off',
      detail: defaultModeOk
        ? 'Unconfigured deployments remain classical.'
        : `Policy defaultMode is ${runtimePolicy.defaultMode}; expected off.`,
    });
    const requireModeOk = Array.isArray(runtimePolicy.modes) && runtimePolicy.modes.includes('require');
    addCheck(checks, {
      id: 'policy.require-mode',
      status: requireModeOk ? 'pass' : 'fail',
      title: 'Policy exposes a fail-closed require mode',
      detail: requireModeOk ? 'Modes include require.' : 'Policy modes must include require.',
    });
  } else {
    addCheck(checks, {
      id: 'policy.present',
      status: 'fail',
      title: 'Post-quantum policy is present',
      detail: 'config/security/post-quantum-policy.json is missing or has no runtimePqc block.',
    });
  }

  const field = fieldConfig();
  const fieldModeValid = FIELD_MODES.has(field.mode);
  addCheck(checks, {
    id: 'field.mode',
    status: fieldModeValid ? 'pass' : 'fail',
    title: 'Field encryption PQC mode is valid',
    detail: fieldModeValid
      ? `Mode "${field.mode}"${field.enabled ? '' : ' (field encryption disabled; configuration is inert)'}.`
      : `FIELD_ENCRYPTION_PQC_MODE=${field.mode} is invalid.`,
  });
  if (fieldModeValid && !field.enabled && (field.mode !== 'off' || field.keyRef)) {
    addCheck(checks, {
      id: 'field.enablement',
      status: 'warn',
      title: 'Field encryption PQC is configured but field encryption is disabled',
      detail: 'FIELD_ENCRYPTION_ENABLED is false, so PQC field envelopes will not be used.',
    });
  }
  const fieldKey = fieldModeValid
    ? await loadSurfaceKeys(checks, {
      idPrefix: 'field',
      registry,
      type: 'hybrid-kem',
      mode: field.mode,
      keyRef: field.keyRef,
      previousRefs: field.previousRefs,
      hardModes: new Set(['key-wrap', 'per-record', 'require']),
      label: 'Field encryption KEM',
    })
    : null;

  const ledger = ledgerConfig();
  const ledgerModeValid = LEDGER_MODES.has(ledger.mode);
  addCheck(checks, {
    id: 'ledger.mode',
    status: ledgerModeValid ? 'pass' : 'fail',
    title: 'Security ledger PQC mode is valid',
    detail: ledgerModeValid
      ? `Mode "${ledger.mode}"${ledger.enabled ? '' : ' (ledger disabled; configuration is inert)'}.`
      : `SECURITY_EVENT_LEDGER_PQC_MODE=${ledger.mode} is invalid.`,
  });
  if (ledgerModeValid && !ledger.enabled && (ledger.mode !== 'off' || ledger.keyRef)) {
    addCheck(checks, {
      id: 'ledger.enablement',
      status: 'warn',
      title: 'Ledger PQC is configured but the ledger is disabled',
      detail: 'SECURITY_EVENT_LEDGER_ENABLED is false, so no events will be signed.',
    });
  }
  const ledgerKey = ledgerModeValid
    ? await loadSurfaceKeys(checks, {
      idPrefix: 'ledger',
      registry,
      type: 'hybrid-signature',
      mode: ledger.mode,
      keyRef: ledger.keyRef,
      previousRefs: ledger.previousRefs,
      hardModes: new Set(['require']),
      label: 'Ledger signing',
    })
    : null;

  if (ledger.requiredFromSeq) {
    const valid = /^\d+$/.test(ledger.requiredFromSeq);
    addCheck(checks, {
      id: 'ledger.required-from-seq',
      status: valid ? 'pass' : 'fail',
      title: 'Ledger PQ signature enforcement sequence is numeric',
      detail: valid
        ? `Signatures are required from seq ${ledger.requiredFromSeq}.`
        : 'SECURITY_EVENT_LEDGER_PQC_REQUIRED_FROM_SEQ must be a non-negative integer.',
    });
  }

  if (options.selfTest) runSelfTest(checks);

  const failures = checks.filter((entry) => entry.status === 'fail');
  const warnings = checks.filter((entry) => entry.status === 'warn');
  const report = {
    generatedAt: new Date().toISOString(),
    nodeVersion: capabilities.nodeVersion,
    opensslVersion: capabilities.opensslVersion,
    capabilities,
    policy: {
      runtimePqcPresent: Boolean(runtimePolicy),
      defaultMode: runtimePolicy?.defaultMode || null,
      modes: runtimePolicy?.modes || [],
    },
    fieldEncryption: {
      enabled: field.enabled,
      configuredMode: field.mode,
      hardMode: ['key-wrap', 'per-record', 'require'].includes(field.mode),
      keyReferenceConfigured: Boolean(field.keyRef),
      previousKeyReferences: field.previousRefs.length,
      key: fieldKey,
    },
    securityLedger: {
      enabled: ledger.enabled,
      configuredMode: ledger.mode,
      keyReferenceConfigured: Boolean(ledger.keyRef),
      previousKeyReferences: ledger.previousRefs.length,
      requiredFromSeq: ledger.requiredFromSeq || null,
      key: ledgerKey,
    },
    summary: {
      status: failures.length ? 'fail' : warnings.length ? 'warn' : 'pass',
      checks: checks.length,
      passed: checks.filter((entry) => entry.status === 'pass').length,
      warnings: warnings.length,
      failed: failures.length,
    },
    checks,
  };

  return report;
};

const renderMarkdown = (report) => {
  const rows = report.checks.map((entry) => (
    `| ${entry.status} | ${entry.id} | ${entry.title} | ${String(entry.detail || '').replace(/\|/g, '\\|')} |`
  ));
  return [
    '# PQC Runtime Status',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Node: ${report.nodeVersion}`,
    `- OpenSSL: ${report.opensslVersion}`,
    `- Field encryption mode: \`${report.fieldEncryption.configuredMode}\``,
    `- Ledger mode: \`${report.securityLedger.configuredMode}\``,
    `- Status: **${report.summary.status}** (${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.failed} failed)`,
    '',
    '| Status | Check | Title | Detail |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
};

const main = async () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  let report;
  try {
    report = await buildReport(options);
  } catch (error) {
    console.error(`PQC runtime status failed: ${error.message}`);
    process.exit(1);
  }

  if (options.json || options.markdown) mkdirSync(options.reportDir, { recursive: true });
  if (options.json) {
    writeFileSync(
      path.join(options.reportDir, 'pqc-runtime-status.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    );
  }
  if (options.markdown) {
    writeFileSync(
      path.join(options.reportDir, 'pqc-runtime-status.md'),
      `${renderMarkdown(report)}\n`,
      'utf8'
    );
  }

  console.log(`PQC runtime status: ${report.summary.status}`);
  for (const entry of report.checks) {
    console.log(`  [${entry.status}] ${entry.id}: ${entry.title} - ${entry.detail}`);
  }

  if (options.strict && report.summary.failed > 0) process.exit(1);
};

main().catch((error) => {
  console.error(`PQC runtime status failed: ${error.message}`);
  process.exit(1);
});
