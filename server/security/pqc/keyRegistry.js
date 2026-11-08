'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    loadKemKeyRecord,
    loadSigningKeyRecord,
    loadSlhDsaKeyRecord,
    publicKemKeysFromRecord,
    publicSigningKeysFromRecord,
    publicSlhDsaKeyFromRecord,
} = require('./keyMaterial');

// Key references are deliberately explicit. A bare string is never guessed to
// be an SSM path: a typo must fail closed instead of silently loading a
// world-readable file or treating a path as JSON.
const SSM_PREFIX = 'ssm:';
const FILE_PREFIX = 'file:';
const BASE64_JSON_PREFIX = 'base64-json:';
const ENV_PREFIX = 'env:';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_REFERENCE_DEPTH = 4;

const LOADERS = {
    'hybrid-kem': loadKemKeyRecord,
    'hybrid-signature': loadSigningKeyRecord,
    'slh-dsa': loadSlhDsaKeyRecord,
};

const PUBLIC_LOADERS = {
    'hybrid-kem': publicKemKeysFromRecord,
    'hybrid-signature': publicSigningKeysFromRecord,
    'slh-dsa': publicSlhDsaKeyFromRecord,
};

const TYPE_ALGORITHMS = {
    'hybrid-kem': 'X25519+ML-KEM-768',
    'hybrid-signature': 'Ed25519+ML-DSA-65',
    'slh-dsa': 'SLH-DSA-SHA2-128s',
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const expandHome = (value) => {
    if (value === '~') return os.homedir();
    if (value.startsWith('~/') || value.startsWith('~\\')) {
        return path.join(os.homedir(), value.slice(2));
    }
    return value;
};

const referenceHash = (reference) => crypto.createHash('sha256')
    .update(typeof reference === 'string' ? reference : JSON.stringify(reference))
    .digest('hex')
    .slice(0, 16);

/**
 * Classify a key reference without reading it.
 *
 * Returning a source label is what lets status output say "key came from SSM
 * SecureString" without echoing the parameter path or any key bytes.
 */
const classifyReference = (reference) => {
    if (isPlainObject(reference)) return { source: 'inline-object', value: reference };
    if (typeof reference !== 'string' || !reference.trim()) {
        throw new Error('PQC key reference must be a non-empty string or key record object');
    }
    const trimmed = reference.trim();
    if (trimmed.startsWith(SSM_PREFIX)) {
        const value = trimmed.slice(SSM_PREFIX.length).trim();
        if (!value) throw new Error('PQC SSM key reference is missing a parameter name');
        return { source: 'ssm', value };
    }
    if (trimmed.startsWith(FILE_PREFIX)) {
        const value = trimmed.slice(FILE_PREFIX.length).trim();
        if (!value) throw new Error('PQC file key reference is missing a path');
        return { source: 'file', value };
    }
    if (trimmed.startsWith(BASE64_JSON_PREFIX)) {
        const value = trimmed.slice(BASE64_JSON_PREFIX.length).trim();
        if (!value) throw new Error('PQC base64 key reference is missing data');
        return { source: 'inline-base64-json', value };
    }
    if (trimmed.startsWith(ENV_PREFIX)) {
        const value = trimmed.slice(ENV_PREFIX.length).trim();
        if (!value) throw new Error('PQC env key reference is missing a variable name');
        return { source: 'env', value };
    }
    if (trimmed.startsWith('{')) return { source: 'inline-json', value: trimmed };
    if (trimmed.endsWith('.json') || trimmed.includes('/') || trimmed.includes('\\')) {
        return { source: 'file', value: trimmed };
    }
    throw new Error(
        'PQC key reference is ambiguous. Use file:/path/key.json, ssm:/parameter/name, '
        + 'base64-json:<data>, env:VARIABLE, or an inline JSON object.'
    );
};

const assertPrivateKeyFilePermissions = (filePath, stat = fs.statSync(filePath)) => {
    if (process.platform === 'win32') {
        // Windows does not expose POSIX permission bits; ACL inspection is left
        // to the deployment platform. The file is still required to live outside
        // a world-readable static directory by the reference policy below.
        return { checked: false, reason: 'windows-acl-not-inspected' };
    }
    const mode = stat.mode & 0o777;
    if (mode & 0o077) {
        throw new Error(
            `PQC private key file ${filePath} is accessible by group/other (mode ${mode.toString(8)}). Run chmod 600.`
        );
    }
    return { checked: true, mode: mode.toString(8) };
};

const readFileReference = (filePath, { requirePrivate }) => {
    const resolved = path.resolve(expandHome(filePath));
    // Stat and read through one descriptor so a swap between the isFile check
    // and the read cannot substitute a different file.
    const fd = fs.openSync(resolved, 'r');
    let text;
    let stat;
    try {
        stat = fs.fstatSync(fd);
        if (!stat.isFile()) throw new Error(`PQC key reference ${resolved} is not a regular file`);
        text = fs.readFileSync(fd, 'utf8');
    } finally {
        fs.closeSync(fd);
    }
    let permissionCheck = { checked: false, reason: 'public-only-key' };
    if (requirePrivate && /"privateKey"\s*:/.test(text)) {
        permissionCheck = assertPrivateKeyFilePermissions(resolved, stat);
    }
    return {
        text,
        sourceDetail: path.basename(resolved),
        permissionCheck,
    };
};

const readSsmReference = async (parameterName, { ssmClient } = {}) => {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
    const client = ssmClient || new SSMClient({});
    const response = await client.send(new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true,
    }));
    const value = response?.Parameter?.Value;
    if (!value) throw new Error(`PQC SSM parameter ${parameterName} returned no value`);
    return {
        text: String(value),
        sourceDetail: parameterName,
        permissionCheck: { checked: false, reason: 'ssm-iam-and-kms-policy' },
    };
};

const readEnvReference = (variableName) => {
    const value = process.env[variableName];
    if (!value) throw new Error(`PQC key environment variable ${variableName} is not set`);
    return { source: 'env-value', value: value.trim() };
};

const decodeJson = (text, source) => {
    try {
        const parsed = JSON.parse(text);
        if (!isPlainObject(parsed)) throw new Error('not a JSON object');
        return parsed;
    } catch (error) {
        throw new Error(`PQC key material from ${source} is not a valid JSON key record: ${error.message}`);
    }
};

const resolveReference = async (reference, { ssmClient, depth = 0 } = {}) => {
    if (depth > MAX_REFERENCE_DEPTH) {
        throw new Error('PQC key reference indirection exceeded the maximum depth');
    }
    const classified = classifyReference(reference);
    if (classified.source === 'inline-object') {
        return { record: classified.value, source: 'inline-object', sourceDetail: null, permissionCheck: null };
    }
    if (classified.source === 'inline-json') {
        return {
            record: decodeJson(classified.value, 'inline JSON'),
            source: 'inline-json',
            sourceDetail: null,
            permissionCheck: null,
        };
    }
    if (classified.source === 'inline-base64-json') {
        const text = Buffer.from(classified.value, 'base64').toString('utf8');
        return {
            record: decodeJson(text, 'inline base64 JSON'),
            source: 'inline-base64-json',
            sourceDetail: null,
            permissionCheck: null,
        };
    }
    if (classified.source === 'file') {
        const read = readFileReference(classified.value, { requirePrivate: true });
        return {
            record: decodeJson(read.text, `file ${read.sourceDetail}`),
            source: 'file',
            sourceDetail: read.sourceDetail,
            permissionCheck: read.permissionCheck,
        };
    }
    if (classified.source === 'ssm') {
        const read = await readSsmReference(classified.value, { ssmClient });
        return {
            record: decodeJson(read.text, `SSM ${read.sourceDetail}`),
            source: 'ssm',
            sourceDetail: read.sourceDetail,
            permissionCheck: read.permissionCheck,
        };
    }
    if (classified.source === 'env') {
        const nested = readEnvReference(classified.value);
        return resolveReference(nested.value, { ssmClient, depth: depth + 1 });
    }
    throw new Error(`Unsupported PQC key reference source: ${classified.source}`);
};

const assertExpectedType = (record, expectedType) => {
    if (!expectedType) return;
    if (record.type !== expectedType) {
        throw new Error(`PQC key record type ${record.type} does not match expected ${expectedType}`);
    }
};

// `loadPublic` accepts either a public-only record or a full record held by a
// verifier. Copy only the public half so a caller cannot accidentally log or
// return the private material that was used to construct the KeyObjects.
const publicRecordShape = (type, record, keyId) => {
    const base = {
        version: record.version,
        type,
        algorithm: TYPE_ALGORITHMS[type],
        keyId,
        createdAt: record.createdAt || null,
    };
    if (type === 'hybrid-kem') {
        return {
            ...base,
            x25519: { publicKey: record.x25519?.publicKey },
            mlKem: { publicKey: record.mlKem?.publicKey },
        };
    }
    if (type === 'hybrid-signature') {
        return {
            ...base,
            ed25519: { publicKey: record.ed25519?.publicKey },
            mlDsa: { publicKey: record.mlDsa?.publicKey },
        };
    }
    return { ...base, slhDsa: { publicKey: record.slhDsa?.publicKey } };
};

const loadRecord = (record, { expectedType }) => {
    assertExpectedType(record, expectedType);
    const loader = LOADERS[record.type];
    if (!loader) throw new Error(`Unsupported PQC key record type: ${record.type}`);
    return loader(record);
};

const loadPublicRecord = (record, { expectedType }) => {
    assertExpectedType(record, expectedType);
    const loader = PUBLIC_LOADERS[record.type];
    if (!loader) throw new Error(`Unsupported PQC key record type: ${record.type}`);
    return loader(record);
};

const normalizeReferenceList = (references) => {
    if (references === undefined || references === null || references === '') return [];
    if (Array.isArray(references)) return references.filter((entry) => entry !== undefined && entry !== null && entry !== '');
    if (typeof references !== 'string') return [references];
    const trimmed = references.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (!Array.isArray(parsed)) throw new Error('not an array');
            return parsed.filter((entry) => entry !== undefined && entry !== null && entry !== '');
        } catch (error) {
            throw new Error(`PQC previous key reference list is not valid JSON: ${error.message}`);
        }
    }
    // A single inline JSON record contains commas of its own; splitting it
    // would shred the key. Multiple inline records must use a JSON array.
    if (trimmed.startsWith('{')) return [trimmed];
    return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
};

/**
 * Resolves key references and caches the validated record.
 *
 * The registry never writes key bytes to logs or status output. It returns
 * loaded KeyObjects to callers and keeps only fingerprints/metadata for status.
 */
class PqcKeyRegistry {
    constructor({ cacheTtlMs = DEFAULT_CACHE_TTL_MS, logger = null, ssmClient = null } = {}) {
        this.cacheTtlMs = Number(cacheTtlMs) > 0 ? Number(cacheTtlMs) : DEFAULT_CACHE_TTL_MS;
        this.logger = logger;
        this.ssmClient = ssmClient;
        this.cache = new Map();
        this.statusEntries = new Map();
    }

    cacheKey(type, reference, { publicOnly }) {
        return `${type}:${publicOnly ? 'public' : 'private'}:${referenceHash(reference)}`;
    }

    async load(type, reference, options = {}) {
        const { refresh = false, ssmClient = this.ssmClient } = options;
        if (!LOADERS[type]) throw new Error(`Unsupported PQC key type: ${type}`);
        const cacheKey = this.cacheKey(type, reference, { publicOnly: false });
        const cached = this.cache.get(cacheKey);
        if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;

        const resolved = await resolveReference(reference, { ssmClient });
        let loaded;
        try {
            loaded = loadRecord(resolved.record, { expectedType: type });
        } catch (error) {
            throw new Error(`Failed to load PQC ${type} key from ${resolved.source}: ${error.message}`);
        }

        const value = {
            ...loaded,
            source: resolved.source,
            sourceDetail: resolved.sourceDetail,
            permissionCheck: resolved.permissionCheck,
        };
        this.cache.set(cacheKey, { value, expiresAt: Date.now() + this.cacheTtlMs });
        this.statusEntries.set(cacheKey, {
            type,
            algorithm: value.record.algorithm,
            keyId: value.keyId,
            createdAt: value.record.createdAt || null,
            source: resolved.source,
            hasPrivateKey: true,
            permissionCheck: resolved.permissionCheck,
            loadedAt: new Date().toISOString(),
        });
        return value;
    }

    async loadPublic(type, reference, options = {}) {
        const { refresh = false, ssmClient = this.ssmClient } = options;
        if (!PUBLIC_LOADERS[type]) throw new Error(`Unsupported PQC key type: ${type}`);
        const cacheKey = this.cacheKey(type, reference, { publicOnly: true });
        const cached = this.cache.get(cacheKey);
        if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;

        const resolved = await resolveReference(reference, { ssmClient });
        let keys;
        let keyId;
        try {
            keys = loadPublicRecord(resolved.record, { expectedType: type });
            keyId = keys.keyId;
        } catch (error) {
            throw new Error(`Failed to load PQC ${type} public key from ${resolved.source}: ${error.message}`);
        }

        const value = {
            keyId,
            publicKeys: keys,
            publicRecord: publicRecordShape(type, resolved.record, keyId),
            source: resolved.source,
            sourceDetail: resolved.sourceDetail,
        };
        this.cache.set(cacheKey, { value, expiresAt: Date.now() + this.cacheTtlMs });
        this.statusEntries.set(cacheKey, {
            type,
            algorithm: keys.algorithm || TYPE_ALGORITHMS[type],
            keyId,
            createdAt: resolved.record.createdAt || null,
            source: resolved.source,
            hasPrivateKey: false,
            permissionCheck: resolved.permissionCheck || null,
            loadedAt: new Date().toISOString(),
        });
        return value;
    }

    /**
     * Load the current key plus previous keys for dual-read rotation.
     * Previous keys are optional; a failure to load one is fatal because
     * silently dropping it would make old ciphertext unreadable.
     */
    async loadRotated(type, currentReference, previousReferences, options = {}) {
        const references = normalizeReferenceList(previousReferences);
        const current = await this.load(type, currentReference, options);
        const previous = [];
        const seen = new Set([current.keyId]);
        for (const reference of references) {
            const loaded = await this.load(type, reference, options);
            if (seen.has(loaded.keyId)) continue;
            seen.add(loaded.keyId);
            previous.push(loaded);
        }
        return { current, previous };
    }

    clear() {
        this.cache.clear();
    }

    /**
     * Metadata-only snapshot. Safe for health endpoints and startup logs.
     */
    getStatus() {
        const entries = [...this.statusEntries.values()].map((entry) => ({
            ...entry,
            permissionCheck: entry.permissionCheck ? { ...entry.permissionCheck } : null,
        }));
        return {
            cacheEntries: this.cache.size,
            keys: entries,
            types: [...new Set(entries.map((entry) => entry.type))],
        };
    }
}

const parseReferenceList = normalizeReferenceList;

module.exports = {
    PqcKeyRegistry,
    classifyReference,
    parseReferenceList,
    normalizeReferenceList,
    assertPrivateKeyFilePermissions,
    referenceHash,
    SSM_PREFIX,
    FILE_PREFIX,
    BASE64_JSON_PREFIX,
    ENV_PREFIX,
    DEFAULT_CACHE_TTL_MS,
};
