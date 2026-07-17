const crypto = require('crypto');

const TRUSTED_DEVICE_V2_WRITE_MODES = Object.freeze([
    'off',
    'dual_write',
]);

const TRUSTED_DEVICE_V2_READ_MODES = Object.freeze([
    'legacy',
    'shadow_compare',
    'v2_with_legacy_fallback',
    'v2_only',
]);

// The V2 collection is deliberately non-authoritative in this release.  A
// cross-collection dual write cannot safely support V2-first authentication
// until every security-sensitive mutation has an atomic cutover path.  Keep
// the future values parseable so a stale deployment fails with a precise
// configuration error instead of silently falling back to legacy reads.
const TRUSTED_DEVICE_V2_RESERVED_READ_MODES = Object.freeze([
    'v2_with_legacy_fallback',
    'v2_only',
]);

const TRUSTED_DEVICE_V2_AUDIENCES = Object.freeze([
    'admin',
    'public',
]);

const DEFAULT_TRUSTED_DEVICE_V2_ROLLOUT = Object.freeze({
    writeMode: 'off',
    readMode: 'legacy',
    adminCohortPercent: 0,
    publicCohortPercent: 0,
    allowlist: Object.freeze([]),
    cohortSeed: 'trusted-device-v2-default',
});

const ENV_KEYS = Object.freeze({
    writeMode: 'AUTH_TRUSTED_DEVICE_V2_WRITE_MODE',
    readMode: 'AUTH_TRUSTED_DEVICE_V2_READ_MODE',
    adminCohortPercent: 'AUTH_TRUSTED_DEVICE_V2_ADMIN_COHORT_PERCENT',
    publicCohortPercent: 'AUTH_TRUSTED_DEVICE_V2_PUBLIC_COHORT_PERCENT',
    allowlist: 'AUTH_TRUSTED_DEVICE_V2_ALLOWLIST',
    cohortSeed: 'AUTH_TRUSTED_DEVICE_V2_COHORT_SEED',
});

const normalizeValue = (value) => String(value === undefined || value === null ? '' : value).trim();

const invalidConfig = (name, message) => {
    const error = new Error(`${name} ${message}`);
    error.code = 'TRUSTED_DEVICE_V2_CONFIG_INVALID';
    error.configKey = name;
    return error;
};

const parseMode = ({ env, name, allowed, fallback }) => {
    const raw = normalizeValue(env[name]);
    if (!raw) return fallback;

    const normalized = raw.toLowerCase();
    if (!allowed.includes(normalized)) {
        throw invalidConfig(name, `must be one of: ${allowed.join(', ')}`);
    }
    return normalized;
};

const parsePercent = ({ env, name, fallback }) => {
    const raw = normalizeValue(env[name]);
    if (!raw) return fallback;
    if (!/^\d{1,3}$/.test(raw)) {
        throw invalidConfig(name, 'must be an integer from 0 through 100');
    }

    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100) {
        throw invalidConfig(name, 'must be an integer from 0 through 100');
    }
    return parsed;
};

const normalizeSubjectId = (value) => normalizeValue(value).toLowerCase();

const parseAllowlist = (env) => {
    const raw = normalizeValue(env[ENV_KEYS.allowlist]);
    if (!raw) return [];

    const entries = raw
        .split(',')
        .map(normalizeSubjectId)
        .filter(Boolean);

    if (entries.length > 500) {
        throw invalidConfig(ENV_KEYS.allowlist, 'must contain no more than 500 entries');
    }
    if (entries.some((entry) => entry.length > 256)) {
        throw invalidConfig(ENV_KEYS.allowlist, 'entries must contain no more than 256 characters');
    }

    return [...new Set(entries)].sort();
};

const parseCohortSeed = (env) => {
    const seed = normalizeValue(env[ENV_KEYS.cohortSeed])
        || DEFAULT_TRUSTED_DEVICE_V2_ROLLOUT.cohortSeed;
    if (seed.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(seed)) {
        throw invalidConfig(
            ENV_KEYS.cohortSeed,
            'must contain 1-128 letters, numbers, dots, underscores, colons, or hyphens'
        );
    }
    return seed;
};

const getTrustedDeviceV2RolloutConfig = (env = process.env) => {
    const writeMode = parseMode({
        env,
        name: ENV_KEYS.writeMode,
        allowed: TRUSTED_DEVICE_V2_WRITE_MODES,
        fallback: DEFAULT_TRUSTED_DEVICE_V2_ROLLOUT.writeMode,
    });
    const readMode = parseMode({
        env,
        name: ENV_KEYS.readMode,
        allowed: TRUSTED_DEVICE_V2_READ_MODES,
        fallback: DEFAULT_TRUSTED_DEVICE_V2_ROLLOUT.readMode,
    });
    const adminCohortPercent = parsePercent({
        env,
        name: ENV_KEYS.adminCohortPercent,
        fallback: DEFAULT_TRUSTED_DEVICE_V2_ROLLOUT.adminCohortPercent,
    });
    const publicCohortPercent = parsePercent({
        env,
        name: ENV_KEYS.publicCohortPercent,
        fallback: DEFAULT_TRUSTED_DEVICE_V2_ROLLOUT.publicCohortPercent,
    });
    const allowlist = parseAllowlist(env);
    const cohortSeed = parseCohortSeed(env);

    if (TRUSTED_DEVICE_V2_RESERVED_READ_MODES.includes(readMode)) {
        throw invalidConfig(
            ENV_KEYS.readMode,
            `${readMode} is reserved until the atomic V2 cutover path and approved cutover evidence are deployed`
        );
    }

    return Object.freeze({
        writeMode,
        readMode,
        adminCohortPercent,
        publicCohortPercent,
        allowlist: Object.freeze(allowlist),
        cohortSeed,
    });
};

const getTrustedDeviceV2CohortBucket = ({
    subjectId,
    audience,
    cohortSeed = DEFAULT_TRUSTED_DEVICE_V2_ROLLOUT.cohortSeed,
}) => {
    const normalizedSubjectId = normalizeSubjectId(subjectId);
    const normalizedAudience = normalizeValue(audience).toLowerCase();
    if (!normalizedSubjectId) {
        throw new TypeError('subjectId is required for trusted-device V2 cohort selection');
    }
    if (!TRUSTED_DEVICE_V2_AUDIENCES.includes(normalizedAudience)) {
        throw new TypeError(`audience must be one of: ${TRUSTED_DEVICE_V2_AUDIENCES.join(', ')}`);
    }

    const digest = crypto
        .createHash('sha256')
        .update(`aura/trusted-device-v2/${cohortSeed}/${normalizedAudience}/${normalizedSubjectId}`)
        .digest();
    return digest.readUInt32BE(0) % 100;
};

const isTrustedDeviceV2SubjectSelected = ({
    subjectId,
    audience,
    config = getTrustedDeviceV2RolloutConfig(),
}) => {
    const normalizedSubjectId = normalizeSubjectId(subjectId);
    if (!normalizedSubjectId) return false;
    const normalizedAudience = normalizeValue(audience).toLowerCase();
    if (!TRUSTED_DEVICE_V2_AUDIENCES.includes(normalizedAudience)) {
        throw new TypeError(`audience must be one of: ${TRUSTED_DEVICE_V2_AUDIENCES.join(', ')}`);
    }
    if (config.allowlist.includes(normalizedSubjectId)) return true;

    const percent = normalizedAudience === 'admin'
        ? config.adminCohortPercent
        : config.publicCohortPercent;
    if (percent === 0) return false;
    if (percent === 100) return true;

    return getTrustedDeviceV2CohortBucket({
        subjectId: normalizedSubjectId,
        audience: normalizedAudience,
        cohortSeed: config.cohortSeed,
    }) < percent;
};

const assertTrustedDeviceV2RolloutConfig = (env = process.env) => {
    getTrustedDeviceV2RolloutConfig(env);
};

module.exports = {
    DEFAULT_TRUSTED_DEVICE_V2_ROLLOUT,
    ENV_KEYS,
    TRUSTED_DEVICE_V2_AUDIENCES,
    TRUSTED_DEVICE_V2_READ_MODES,
    TRUSTED_DEVICE_V2_RESERVED_READ_MODES,
    TRUSTED_DEVICE_V2_WRITE_MODES,
    assertTrustedDeviceV2RolloutConfig,
    getTrustedDeviceV2CohortBucket,
    getTrustedDeviceV2RolloutConfig,
    isTrustedDeviceV2SubjectSelected,
    normalizeSubjectId,
};
