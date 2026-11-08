#!/usr/bin/env node
/**
 * Generate a CycloneDX 1.6 Cryptography Bill of Materials (CBOM) for the Aura
 * application-layer post-quantum layer.
 *
 * The CBOM is derived from the same policy and module constants the runtime
 * uses, so a rename or algorithm change cannot silently leave the inventory
 * stale. `--strict` fails when the policy and the implementation disagree.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const algorithms = require('../../server/security/pqc/algorithms.js');

// CycloneDX 1.6 uses closed enums for these fields. Keep a local mirror so a
// generator change cannot silently emit an invalid CBOM. Source:
// https://cyclonedx.org/schema/bom-1.6.schema.json
const CBOM_ENUMS = {
  assetType: new Set(['algorithm', 'certificate', 'protocol', 'related-crypto-material']),
  primitive: new Set([
    'drbg', 'mac', 'block-cipher', 'stream-cipher', 'signature', 'hash', 'pke', 'xof',
    'kdf', 'key-agree', 'kem', 'ae', 'combiner', 'other', 'unknown',
  ]),
  executionEnvironment: new Set([
    'software-plain-ram', 'software-encrypted-ram', 'software-tee', 'hardware', 'other', 'unknown',
  ]),
  implementationPlatform: new Set([
    'generic', 'x86_32', 'x86_64', 'armv7-a', 'armv7-m', 'armv8-a', 'armv8-m',
    'armv9-a', 'armv9-m', 's390x', 'ppc64', 'ppc64le', 'other', 'unknown',
  ]),
  certificationLevel: new Set([
    'none',
    'fips140-1-l1', 'fips140-1-l2', 'fips140-1-l3', 'fips140-1-l4',
    'fips140-2-l1', 'fips140-2-l2', 'fips140-2-l3', 'fips140-2-l4',
    'fips140-3-l1', 'fips140-3-l2', 'fips140-3-l3', 'fips140-3-l4',
    'cc-eal1', 'cc-eal1+', 'cc-eal2', 'cc-eal2+', 'cc-eal3', 'cc-eal3+', 'cc-eal4', 'cc-eal4+',
    'cc-eal5', 'cc-eal5+', 'cc-eal6', 'cc-eal6+', 'cc-eal7', 'cc-eal7+', 'other', 'unknown',
  ]),
  mode: new Set(['cbc', 'ecb', 'ccm', 'gcm', 'cfb', 'ofb', 'ctr', 'other', 'unknown']),
  padding: new Set(['pkcs5', 'pkcs7', 'pkcs1v15', 'oaep', 'raw', 'other', 'unknown']),
  relatedType: new Set([
    'private-key', 'public-key', 'secret-key', 'key', 'ciphertext', 'signature', 'digest',
    'initialization-vector', 'nonce', 'seed', 'salt', 'shared-secret', 'tag', 'additional-data',
    'password', 'credential', 'token', 'other', 'unknown',
  ]),
  state: new Set(['pre-activation', 'active', 'suspended', 'deactivated', 'compromised', 'destroyed']),
  protocolType: new Set(['tls', 'ssh', 'ipsec', 'ike', 'sstp', 'wpa', 'other', 'unknown']),
};

const findCbomEnumViolations = (components) => {
  const violations = [];
  const check = (component, field, value, allowed) => {
    if (value === undefined) return;
    if (!allowed.has(value)) violations.push(`${component['bom-ref']}.${field}=${value}`);
  };

  for (const component of components) {
    const crypto = component.cryptoProperties;
    check(component, 'assetType', crypto.assetType, CBOM_ENUMS.assetType);
    const algorithm = crypto.algorithmProperties;
    if (algorithm) {
      check(component, 'primitive', algorithm.primitive, CBOM_ENUMS.primitive);
      check(component, 'executionEnvironment', algorithm.executionEnvironment, CBOM_ENUMS.executionEnvironment);
      check(component, 'implementationPlatform', algorithm.implementationPlatform, CBOM_ENUMS.implementationPlatform);
      check(component, 'mode', algorithm.mode, CBOM_ENUMS.mode);
      check(component, 'padding', algorithm.padding, CBOM_ENUMS.padding);
      for (const level of algorithm.certificationLevel || []) {
        check(component, 'certificationLevel', level, CBOM_ENUMS.certificationLevel);
      }
    }
    const material = crypto.relatedCryptoMaterialProperties;
    if (material) {
      check(component, 'material.type', material.type, CBOM_ENUMS.relatedType);
      check(component, 'material.state', material.state, CBOM_ENUMS.state);
    }
    const protocol = crypto.protocolProperties;
    if (protocol) {
      check(component, 'protocol.type', protocol.type, CBOM_ENUMS.protocolType);
    }
  }

  return violations;
};

const parseArgs = (argv) => {
  const options = {
    root: process.cwd(),
    reportDir: path.join(process.cwd(), 'reports', 'security'),
    json: false,
    markdown: false,
    strict: false,
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
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: generate-cbom.mjs [--json] [--markdown] [--strict] [--root <path>] [--report-dir <path>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const asset = ({
  bomRef,
  name,
  description,
  assetType,
  algorithmProperties,
  protocolProperties,
  relatedCryptoMaterialProperties,
  properties = [],
}) => ({
  type: 'cryptographic-asset',
  'bom-ref': bomRef,
  name,
  description,
  cryptoProperties: {
    assetType,
    ...(algorithmProperties ? { algorithmProperties } : {}),
    ...(protocolProperties ? { protocolProperties } : {}),
    ...(relatedCryptoMaterialProperties ? { relatedCryptoMaterialProperties } : {}),
  },
  ...(properties.length ? { properties } : {}),
});

const boolProperty = (name, value) => ({ name, value: String(Boolean(value)) });

export const buildCbom = ({ root = process.cwd(), now = new Date() } = {}) => {
  const policyPath = path.join(root, 'config', 'security', 'post-quantum-policy.json');
  const policy = readJson(policyPath);
  const runtime = policy.runtimePqc || {};
  const capabilities = algorithms.getPqcCapabilities({ refresh: true });

  const expectedPolicy = {
    hybridKem: algorithms.KEM_ALGORITHM,
    hybridSignature: algorithms.SIGNATURE_ALGORITHM,
    hashBasedSignature: algorithms.SLH_DSA_ALGORITHM,
    keyExchangeStandard: algorithms.KEM_NIST_STANDARD,
    signatureStandard: algorithms.SIGNATURE_NIST_STANDARD,
    hashSignatureStandard: algorithms.SLH_DSA_NIST_STANDARD,
  };
  const policyMismatches = Object.entries(expectedPolicy)
    .filter(([key, value]) => runtime[key] !== value)
    .map(([key, value]) => ({ key, expected: value, actual: runtime[key] ?? null }));

  const components = [
    asset({
      bomRef: 'aura:crypto:algorithm:hybrid-kem',
      name: 'X25519 + ML-KEM-768',
      description: 'Hybrid key encapsulation used for field-encryption data keys and per-record envelopes. Both shared secrets are required and combined with HKDF-SHA256.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'kem',
        parameterSetIdentifier: 'ML-KEM-768',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
      },
      properties: [
        { name: 'aura:standard', value: `${algorithms.KEM_NIST_STANDARD} + RFC 7748` },
        { name: 'aura:nist-quantum-security-level', value: String(algorithms.KEM_NIST_LEVEL) },
        { name: 'aura:source', value: 'server/security/pqc/hybridKem.js' },
        { name: 'aura:default-mode', value: runtime.defaultMode || 'off' },
        boolProperty('aura:runtime-available', capabilities.algorithms.mlKem.available),
      ],
    }),
    asset({
      bomRef: 'aura:crypto:algorithm:ml-kem-768',
      name: 'ML-KEM-768',
      description: 'NIST FIPS 203 module-lattice key encapsulation mechanism.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'kem',
        parameterSetIdentifier: 'ML-KEM-768',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
      },
      properties: [
        { name: 'aura:standard', value: algorithms.KEM_NIST_STANDARD },
        { name: 'aura:nist-quantum-security-level', value: String(algorithms.KEM_NIST_LEVEL) },
        boolProperty('aura:runtime-available', capabilities.algorithms.mlKem.available),
      ],
    }),
    asset({
      bomRef: 'aura:crypto:algorithm:x25519',
      name: 'X25519',
      description: 'Classical X25519 key-agreement leg of the hybrid KEM. It is never used alone for application payloads.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'key-agree',
        parameterSetIdentifier: 'Curve25519',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
      },
      properties: [
        { name: 'aura:standard', value: 'RFC 7748' },
        { name: 'aura:nist-quantum-security-level', value: '0' },
      ],
    }),
    asset({
      bomRef: 'aura:crypto:algorithm:hybrid-signature',
      name: 'Ed25519 + ML-DSA-65',
      description: 'Hybrid signature for security-event ledger records. Both signatures must verify.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'signature',
        parameterSetIdentifier: 'ML-DSA-65',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
      },
      properties: [
        { name: 'aura:standard', value: `${algorithms.SIGNATURE_NIST_STANDARD} + RFC 8032` },
        { name: 'aura:nist-quantum-security-level', value: String(algorithms.SIGNATURE_NIST_LEVEL) },
        { name: 'aura:source', value: 'server/security/pqc/hybridSignature.js' },
        boolProperty('aura:runtime-available', capabilities.algorithms.mlDsa.available),
      ],
    }),
    asset({
      bomRef: 'aura:crypto:algorithm:ml-dsa-65',
      name: 'ML-DSA-65',
      description: 'NIST FIPS 204 module-lattice digital signature algorithm.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'signature',
        parameterSetIdentifier: 'ML-DSA-65',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
      },
      properties: [
        { name: 'aura:standard', value: algorithms.SIGNATURE_NIST_STANDARD },
        { name: 'aura:nist-quantum-security-level', value: String(algorithms.SIGNATURE_NIST_LEVEL) },
        boolProperty('aura:runtime-available', capabilities.algorithms.mlDsa.available),
      ],
    }),
    asset({
      bomRef: 'aura:crypto:algorithm:ed25519',
      name: 'Ed25519',
      description: 'Classical signature leg of the hybrid ledger signature.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'signature',
        parameterSetIdentifier: 'Ed25519',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
      },
      properties: [
        { name: 'aura:standard', value: 'RFC 8032' },
        { name: 'aura:nist-quantum-security-level', value: '0' },
      ],
    }),
    asset({
      bomRef: 'aura:crypto:algorithm:slh-dsa-sha2-128s',
      name: 'SLH-DSA-SHA2-128s',
      description: 'NIST FIPS 205 hash-based signature reserved for long-lived offline ledger checkpoints, never request paths.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'signature',
        parameterSetIdentifier: 'SLH-DSA-SHA2-128s',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
      },
      properties: [
        { name: 'aura:standard', value: algorithms.SLH_DSA_NIST_STANDARD },
        { name: 'aura:nist-quantum-security-level', value: String(algorithms.SLH_DSA_NIST_LEVEL) },
        boolProperty('aura:runtime-available', capabilities.algorithms.slhDsa.available),
      ],
    }),
    asset({
      bomRef: 'aura:crypto:algorithm:aes-256-gcm',
      name: 'AES-256-GCM',
      description: 'AEAD protecting field-encryption records and wrapped data keys.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'ae',
        parameterSetIdentifier: '256',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
        mode: 'gcm',
      },
      properties: [
        { name: 'aura:standard', value: 'NIST SP 800-38D' },
        { name: 'aura:nist-quantum-security-level', value: '1' },
      ],
    }),
    asset({
      bomRef: 'aura:crypto:algorithm:hkdf-sha256',
      name: 'HKDF-SHA256',
      description: 'Domain-separated key derivation combining the X25519 and ML-KEM shared secrets and deriving DEKs.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'kdf',
        parameterSetIdentifier: 'SHA-256',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
      },
      properties: [
        { name: 'aura:standard', value: 'RFC 5869' },
        { name: 'aura:nist-quantum-security-level', value: '1' },
      ],
    }),
    asset({
      bomRef: 'aura:crypto:algorithm:hmac-sha256',
      name: 'HMAC-SHA256',
      description: 'Tamper-evident security-event ledger chain. PQ signatures are additive, not a replacement.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'mac',
        parameterSetIdentifier: 'SHA-256',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
      },
      properties: [
        { name: 'aura:standard', value: 'RFC 2104' },
        { name: 'aura:nist-quantum-security-level', value: '1' },
      ],
    }),
    asset({
      bomRef: 'aura:crypto:algorithm:sha-256',
      name: 'SHA-256',
      description: 'Key fingerprints, ledger record hashes, and transcript hashing.',
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: 'hash',
        parameterSetIdentifier: 'SHA-256',
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
      },
      properties: [
        { name: 'aura:standard', value: 'FIPS 180-4' },
        { name: 'aura:nist-quantum-security-level', value: '1' },
      ],
    }),
    asset({
      bomRef: 'aura:crypto:protocol:tls-1.3',
      name: 'TLS 1.3',
      description: 'Transport baseline. Hybrid X25519MLKEM768 is measured per edge; provider support varies.',
      assetType: 'protocol',
      protocolProperties: {
        type: 'tls',
        version: '1.3',
        cipherSuites: [
          { name: 'TLS_AES_256_GCM_SHA384' },
          { name: 'TLS_CHACHA20_POLY1305_SHA256' },
          { name: 'TLS_AES_128_GCM_SHA256' },
        ],
      },
      properties: [
        { name: 'aura:source', value: 'config/security/tls-edge-posture.json' },
        { name: 'aura:hybrid-group', value: algorithms.TLS_HYBRID_GROUP },
        boolProperty('aura:runtime-available', capabilities.tls.available),
      ],
    }),
    asset({
      bomRef: 'aura:crypto:key:field-encryption-kem',
      name: 'Field encryption hybrid KEM key',
      description: 'Current X25519 + ML-KEM-768 key pair used to wrap per-process data keys. Rotation supports previous-key dual-read.',
      assetType: 'related-crypto-material',
      relatedCryptoMaterialProperties: {
        type: 'private-key',
        state: 'active',
        algorithmRef: 'aura:crypto:algorithm:hybrid-kem',
      },
      properties: [
        { name: 'aura:source', value: 'FIELD_ENCRYPTION_PQC_KEM_KEY_REF' },
        { name: 'aura:rotation', value: 'FIELD_ENCRYPTION_PQC_KEM_PREVIOUS_KEY_REFS' },
      ],
    }),
    asset({
      bomRef: 'aura:crypto:key:field-encryption-dek',
      name: 'Field encryption data key',
      description: 'AES-256-GCM data key. In key-wrap mode it is wrapped by the hybrid KEM and embedded in each record.',
      assetType: 'related-crypto-material',
      relatedCryptoMaterialProperties: {
        type: 'secret-key',
        state: 'active',
        size: 256,
        algorithmRef: 'aura:crypto:algorithm:aes-256-gcm',
      },
      properties: [
        { name: 'aura:storage', value: 'in-memory plus PQ-wrapped record envelope' },
      ],
    }),
    asset({
      bomRef: 'aura:crypto:key:ledger-signing',
      name: 'Security ledger hybrid signing key',
      description: 'Current Ed25519 + ML-DSA-65 key pair for ledger records. The HMAC chain remains the primary integrity control.',
      assetType: 'related-crypto-material',
      relatedCryptoMaterialProperties: {
        type: 'private-key',
        state: 'active',
        algorithmRef: 'aura:crypto:algorithm:hybrid-signature',
      },
      properties: [
        { name: 'aura:source', value: 'SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF' },
        { name: 'aura:rotation', value: 'SECURITY_EVENT_LEDGER_PQC_PREVIOUS_KEY_REFS' },
      ],
    }),
    asset({
      bomRef: 'aura:crypto:key:ledger-hmac',
      name: 'Security ledger HMAC key',
      description: 'HMAC-SHA256 chain secret. Unchanged by the PQ layer and required for every record.',
      assetType: 'related-crypto-material',
      relatedCryptoMaterialProperties: {
        type: 'secret-key',
        state: 'active',
        size: 256,
        algorithmRef: 'aura:crypto:algorithm:hmac-sha256',
      },
      properties: [
        { name: 'aura:source', value: 'SECURITY_EVENT_LEDGER_SECRET' },
      ],
    }),
    asset({
      bomRef: 'aura:crypto:key:checkpoint-slh-dsa',
      name: 'Ledger checkpoint SLH-DSA key',
      description: 'Optional long-lived offline key for publishing periodic checkpoints. Not loaded on request paths.',
      assetType: 'related-crypto-material',
      relatedCryptoMaterialProperties: {
        type: 'private-key',
        state: 'pre-activation',
        algorithmRef: 'aura:crypto:algorithm:slh-dsa-sha2-128s',
      },
      properties: [
        { name: 'aura:usage', value: 'offline-checkpoint-anchor' },
      ],
    }),
  ];

  // Promote the NIST category from the human-readable property into the
  // schema-defined field so CycloneDX consumers can reason about it directly.
  for (const component of components) {
    const algorithmProperties = component.cryptoProperties?.algorithmProperties;
    if (!algorithmProperties) continue;
    const level = (component.properties || [])
      .find((entry) => entry.name === 'aura:nist-quantum-security-level');
    const parsed = Number(level?.value);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 6) {
      algorithmProperties.nistQuantumSecurityLevel = parsed;
    }
  }

  const uniqueRefs = new Set(components.map((component) => component['bom-ref']));
  const duplicateRefs = components
    .map((component) => component['bom-ref'])
    .filter((ref, index, refs) => refs.indexOf(ref) !== index);

  const requiredFiles = [
    'server/security/pqc/algorithms.js',
    'server/security/pqc/keyMaterial.js',
    'server/security/pqc/keyRegistry.js',
    'server/security/pqc/hybridKem.js',
    'server/security/pqc/hybridSignature.js',
    'server/services/fieldEncryptionService.js',
    'server/services/securityEventLedgerService.js',
  ];
  const missingFiles = requiredFiles.filter((file) => !existsSync(path.join(root, file)));
  const enumViolations = findCbomEnumViolations(components);

  const checks = [
    {
      id: 'policy.runtime-pqc',
      status: runtime && runtime.defaultMode ? 'pass' : 'fail',
      detail: runtime && runtime.defaultMode
        ? `Runtime policy present with default mode ${runtime.defaultMode}.`
        : 'runtimePqc policy block is missing.',
    },
    {
      id: 'policy.default-mode-off',
      status: runtime.defaultMode === 'off' ? 'pass' : 'fail',
      detail: runtime.defaultMode === 'off'
        ? 'Unconfigured deployments remain classical.'
        : `defaultMode is ${runtime.defaultMode}; expected off.`,
    },
    {
      id: 'policy.require-mode',
      status: Array.isArray(runtime.modes) && runtime.modes.includes('require') ? 'pass' : 'fail',
      detail: Array.isArray(runtime.modes) && runtime.modes.includes('require')
        ? 'Modes include require.'
        : 'Policy modes must include require.',
    },
    {
      id: 'policy.algorithm-match',
      status: policyMismatches.length === 0 ? 'pass' : 'fail',
      detail: policyMismatches.length === 0
        ? 'Policy algorithm identifiers match the runtime constants.'
        : `Policy mismatch: ${JSON.stringify(policyMismatches)}`,
    },
    {
      id: 'cbom.unique-refs',
      status: duplicateRefs.length === 0 && uniqueRefs.size === components.length ? 'pass' : 'fail',
      detail: duplicateRefs.length === 0
        ? `${components.length} unique crypto assets.`
        : `Duplicate bom-refs: ${duplicateRefs.join(', ')}`,
    },
    {
      id: 'cbom.required-files',
      status: missingFiles.length === 0 ? 'pass' : 'fail',
      detail: missingFiles.length === 0
        ? 'All PQC runtime modules exist.'
        : `Missing modules: ${missingFiles.join(', ')}`,
    },
    {
      id: 'cbom.schema-enums',
      status: enumViolations.length === 0 ? 'pass' : 'fail',
      detail: enumViolations.length === 0
        ? 'All cryptographic asset fields use CycloneDX 1.6 enum values.'
        : `Invalid CycloneDX enum values: ${enumViolations.join(', ')}`,
    },
  ];

  const summary = {
    status: checks.some((entry) => entry.status === 'fail') ? 'fail' : 'pass',
    checks: checks.length,
    failed: checks.filter((entry) => entry.status === 'fail').length,
    components: components.length,
  };

  const serialSeed = JSON.stringify({ policyVersion: policy.policyVersion, refs: [...uniqueRefs], summary });
  const digest = require('node:crypto').createHash('sha256').update(serialSeed).digest('hex');
  const serialNumber = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;

  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber,
    version: 1,
    metadata: {
      timestamp: now.toISOString(),
      tools: {
        components: [
          {
            type: 'application',
            name: 'aura-pqc-cbom-generator',
            version: '1.0.0',
          },
        ],
      },
      component: {
        type: 'application',
        'bom-ref': 'aura:application:marketplace',
        name: 'aura-marketplace',
        description: 'Aura Marketplace API and web application.',
      },
      properties: [
        { name: 'aura:policy-version', value: String(policy.policyVersion || 'unknown') },
        { name: 'aura:runtime-status', value: summary.status },
        { name: 'aura:node-version', value: capabilities.nodeVersion },
        { name: 'aura:openssl-version', value: capabilities.opensslVersion },
      ],
    },
    components,
    dependencies: [
      {
        ref: 'aura:application:marketplace',
        dependsOn: components.map((component) => component['bom-ref']),
      },
    ],
    properties: [
      { name: 'aura:scope', value: 'application-layer cryptography; provider-managed edge TLS is tracked separately' },
      { name: 'aura:generated-at', value: now.toISOString() },
    ],
  };

  return { bom, checks, summary, policy, capabilities };
};

const renderMarkdown = ({ bom, checks, summary }) => {
  const rows = bom.components.map((component) => {
    const crypto = component.cryptoProperties;
    const algorithm = crypto.algorithmProperties || {};
    const standard = (component.properties || []).find((entry) => entry.name === 'aura:standard')?.value || '';
    return `| ${component.name} | ${crypto.assetType} | ${algorithm.primitive || crypto.protocolProperties?.type || ''} | ${algorithm.parameterSetIdentifier || crypto.protocolProperties?.version || ''} | ${standard} |`;
  });
  return [
    '# Aura Cryptography Bill of Materials (CBOM)',
    '',
    `- Generated: ${bom.metadata.timestamp}`,
    `- CycloneDX: ${bom.specVersion}`,
    `- Serial: ${bom.serialNumber}`,
    `- Components: ${summary.components}`,
    `- Status: **${summary.status}**`,
    '',
    '| Asset | Type | Primitive | Parameter set | Standard |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Checks',
    '',
    '| Status | Check | Detail |',
    '| --- | --- | --- |',
    ...checks.map((entry) => `| ${entry.status} | ${entry.id} | ${String(entry.detail).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n');
};

const main = () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  let result;
  try {
    result = buildCbom({ root: options.root });
  } catch (error) {
    console.error(`CBOM generation failed: ${error.message}`);
    process.exit(1);
  }

  if (options.json || options.markdown) mkdirSync(options.reportDir, { recursive: true });
  if (options.json) {
    writeFileSync(
      path.join(options.reportDir, 'cbom.json'),
      `${JSON.stringify(result.bom, null, 2)}\n`,
      'utf8'
    );
  }
  if (options.markdown) {
    writeFileSync(
      path.join(options.reportDir, 'cbom.md'),
      `${renderMarkdown(result)}\n`,
      'utf8'
    );
  }

  console.log(`CBOM: ${result.summary.status} (${result.summary.components} components, ${result.summary.failed} failed checks)`);
  for (const entry of result.checks) {
    console.log(`  [${entry.status}] ${entry.id}: ${entry.detail}`);
  }

  if (options.strict && result.summary.failed > 0) process.exit(1);
};

main();
