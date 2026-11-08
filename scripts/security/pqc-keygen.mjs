#!/usr/bin/env node
/**
 * Generate application-layer PQC key material for the Aura runtime.
 *
 * The private record is written with owner-only permissions and is never
 * printed. Store it in a secret manager (SSM SecureString, mounted secret, or
 * an operator-controlled 0600 file) and reference it by `ssm:`/`file:`/`env:`
 * from the service configuration.
 *
 * `--compact` omits the redundant public keys from the stored record. The
 * loader derives them from the private keys and verifies any supplied public
 * key, so compact records remain fully validated. Use it when the record must
 * fit a size-limited secret store: the standard hybrid-signature record is
 * larger than SSM's 8 KB Advanced limit, while the compact record fits.
 *
 * Usage:
 *   node scripts/security/pqc-keygen.mjs --type hybrid-kem --out ./secrets/field-kem.json \
 *     --public-out ./config/public/field-kem.pub.json
 *   node scripts/security/pqc-keygen.mjs --type hybrid-signature --compact --out ./secrets/ledger-signing.json
 *   node scripts/security/pqc-keygen.mjs --type slh-dsa --out ./secrets/checkpoint-slh.json
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const keyMaterial = require('../../server/security/pqc/keyMaterial.js');

const TYPES = {
  'hybrid-kem': {
    generate: keyMaterial.generateHybridKemKey,
    load: keyMaterial.loadKemKeyRecord,
    description: 'X25519 + ML-KEM-768 key encapsulation key (FIPS 203)',
  },
  'hybrid-signature': {
    generate: keyMaterial.generateHybridSigningKey,
    load: keyMaterial.loadSigningKeyRecord,
    description: 'Ed25519 + ML-DSA-65 signing key (FIPS 204)',
  },
  'slh-dsa': {
    generate: keyMaterial.generateSlhDsaKey,
    load: keyMaterial.loadSlhDsaKeyRecord,
    description: 'SLH-DSA-SHA2-128s long-lived offline anchor key (FIPS 205)',
  },
};

const usage = () => `Usage: pqc-keygen.mjs --type <${Object.keys(TYPES).join('|')}> --out <path> [--public-out <path>] [--compact] [--force]

Writes a private key record with owner-only permissions (0600 on POSIX).
Existing files are never overwritten without --force, and symlinks are refused.
--compact omits redundant public keys so the record fits size-limited secret stores.`;

const parseArgs = (argv) => {
  const options = {
    type: null,
    out: null,
    publicOut: null,
    compact: false,
    force: false,
    createdAt: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--type') {
      options.type = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      options.out = argv[index + 1];
      index += 1;
    } else if (arg === '--public-out') {
      options.publicOut = argv[index + 1];
      index += 1;
    } else if (arg === '--created-at') {
      options.createdAt = argv[index + 1];
      index += 1;
    } else if (arg === '--compact') {
      options.compact = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const ensureSafeTarget = (file, { force }) => {
  if (existsSync(file)) {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to write PQC key material through a symlink: ${file}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Refusing to overwrite a non-regular file with PQC key material: ${file}`);
    }
    if (!force) {
      throw new Error(`Refusing to overwrite existing key material: ${file}. Pass --force to rotate.`);
    }
  }
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
};

const writeJson = (file, value, { mode, force }) => {
  ensureSafeTarget(file, { force });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(file, text, { encoding: 'utf8', mode, flag: force ? 'w' : 'wx' });
  if (process.platform !== 'win32') chmodSync(file, mode);
};

// Public keys are redundant: every loader derives them from the private key and
// rejects a mismatch. Dropping them keeps the private record inside SSM limits
// without weakening validation.
const compactRecord = (record) => {
  const copy = JSON.parse(JSON.stringify(record));
  for (const keyName of ['x25519', 'mlKem', 'ed25519', 'mlDsa', 'slhDsa']) {
    if (copy[keyName] && typeof copy[keyName] === 'object') {
      delete copy[keyName].publicKey;
    }
  }
  return copy;
};

const main = () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }

  if (!options.type || !TYPES[options.type]) {
    console.error(`--type must be one of: ${Object.keys(TYPES).join(', ')}`);
    console.error(usage());
    process.exit(2);
  }
  if (!options.out) {
    console.error('--out is required; private key material must be written to a controlled file');
    process.exit(2);
  }

  const definition = TYPES[options.type];
  const record = definition.generate({ createdAt: options.createdAt });
  const storedRecord = options.compact ? compactRecord(record) : record;
  const loaded = definition.load(storedRecord);
  const publicRecord = keyMaterial.toPublicRecord(storedRecord);

  writeJson(options.out, storedRecord, { mode: 0o600, force: options.force });
  if (options.publicOut) {
    writeJson(options.publicOut, publicRecord, { mode: 0o644, force: options.force });
  }

  // Metadata only. Printing the record would leak private key bytes into shell
  // history and CI logs.
  const summary = {
    type: storedRecord.type,
    algorithm: storedRecord.algorithm,
    keyId: loaded.keyId,
    createdAt: storedRecord.createdAt,
    compact: options.compact,
    recordBytes: statSync(options.out).size,
    privateKeyFile: path.resolve(options.out),
    publicKeyFile: options.publicOut ? path.resolve(options.publicOut) : null,
    permissions: process.platform === 'win32' ? 'windows-acl-not-inspected' : '0600',
  };
  console.log(JSON.stringify(summary, null, 2));
};

try {
  main();
} catch (error) {
  console.error(`PQC key generation failed: ${error.message}`);
  process.exit(1);
}
