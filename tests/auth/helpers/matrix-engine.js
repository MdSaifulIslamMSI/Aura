'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const MATRIX_PATH = path.join(ROOT_DIR, 'tests/auth/matrix/auth-test-matrix.json');
const AUTO_EXPAND_POLICY_PATH = path.join(ROOT_DIR, 'tests/auth/matrix/auto-expand-policy.json');
const GENERATED_COUNT_PATH = path.join(ROOT_DIR, 'tests/auth/matrix/generated-case-count.json');

const BASE_DIMENSION_KEYS = [
    'userRoles',
    'accountStates',
    'passwordCases',
    'emailCases',
    'tokenStates',
    'sessionStates',
    'otpStates',
    'deviceStates',
    'rateLimitStates',
    'routeTypes',
];

const EXECUTION_POLICY = {
    smoke: '100-500 checks',
    core: '800-2000 checks',
    security: '1000-5000 checks',
    generated: '5000-50000 checks',
    nightly: '100000-500000+ checks',
    critical: '500000-1000000+ checks',
};

const DEFAULT_LIMITS = {
    smoke: 500,
    core: 1500,
    security: 3000,
    generated: 5000,
    nightly: 100000,
    critical: 500000,
};

const MODE_EXPANSION_DEFAULTS = {
    smoke: 'level_0_base',
    core: 'level_0_base',
    security: 'level_1_device',
    generated: 'level_0_base',
    nightly: 'level_2_risk',
    critical: 'level_4_critical',
};

const RISK_VALUES = {
    userRoles: ['admin', 'super_admin', 'support_staff'],
    accountStates: ['locked', 'disabled', 'deleted', 'password_reset_required', 'mfa_required'],
    passwordCases: ['wrong_password', 'empty_password', 'sql_payload_password', 'xss_payload_password', 'leaked_common_password'],
    emailCases: ['unknown_email', 'malformed_email', 'sql_payload_email', 'xss_payload_email'],
    tokenStates: [
        'expired_access_token',
        'malformed_access_token',
        'tampered_access_token',
        'reused_refresh_token',
        'revoked_refresh_token',
        'token_with_wrong_role',
        'token_signed_with_wrong_secret',
        'token_without_required_claims',
    ],
    sessionStates: ['expired_session', 'logged_out_session', 'revoked_session', 'suspicious_session', 'password_changed_session', 'reset_password_session'],
    otpStates: ['wrong_otp', 'expired_otp', 'reused_otp', 'missing_otp', 'too_many_attempts', 'otp_for_different_user'],
    deviceStates: ['suspicious_device', 'changed_user_agent', 'changed_ip', 'vpn_like_ip', 'impossible_travel_pattern'],
    rateLimitStates: ['repeated_wrong_password', 'rapid_same_ip', 'rapid_same_account', 'distributed_ip_same_account', 'otp_resend_spam', 'password_reset_spam'],
    routeTypes: ['admin_route', 'super_admin_route', 'seller_route', 'support_route'],
    browserTypes: ['safari', 'mobile_browser'],
    osTypes: ['ios', 'android'],
    geoRiskStates: ['impossible_travel', 'high_risk_region'],
    fraudScoreLevels: ['high', 'critical'],
    paymentRiskStates: ['saved_card_access', 'checkout_attempt', 'refund_attempt', 'high_value_order'],
    apiVersions: ['deprecated_version'],
    behavioralRiskStates: ['bot_like_pattern', 'account_takeover_pattern'],
};

const ROUTE_POLICY = {
    public_route: ['customer', 'seller', 'admin', 'super_admin', 'support_staff', 'delivery_partner'],
    authenticated_customer_route: ['customer', 'seller', 'admin', 'super_admin', 'support_staff', 'delivery_partner'],
    seller_route: ['seller', 'admin', 'super_admin'],
    admin_route: ['admin', 'super_admin'],
    super_admin_route: ['super_admin'],
    support_route: ['support_staff', 'admin', 'super_admin'],
    delivery_route: ['delivery_partner', 'admin', 'super_admin'],
};

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadMatrix() {
    return readJson(MATRIX_PATH);
}

function loadAutoExpandPolicy() {
    return readJson(AUTO_EXPAND_POLICY_PATH);
}

function formatNumber(value) {
    return Number(value).toLocaleString('en-US');
}

function getBaseDimensions(matrix = loadMatrix()) {
    return Object.fromEntries(BASE_DIMENSION_KEYS.map((key) => [key, matrix[key]]));
}

function getExpansionLevel(policy = loadAutoExpandPolicy(), levelName = 'level_0_base') {
    const level = policy.levels[levelName];
    if (!level) {
        throw new Error(`Unknown auth matrix expansion level: ${levelName}`);
    }
    return level;
}

function getDimensionsForLevel(matrix = loadMatrix(), policy = loadAutoExpandPolicy(), levelName = 'level_0_base') {
    const dimensions = { ...getBaseDimensions(matrix) };
    const level = getExpansionLevel(policy, levelName);
    for (const dimensionName of level.enabledDimensions) {
        const values = matrix.futureDimensions?.[dimensionName];
        if (!Array.isArray(values) || values.length === 0) {
            throw new Error(`Auto-expand dimension ${dimensionName} is missing from auth-test-matrix.json`);
        }
        dimensions[dimensionName] = values;
    }
    return dimensions;
}

function countDimensions(dimensions) {
    return Object.values(dimensions).reduce((total, values) => total * BigInt(values.length), 1n);
}

function getDimensionCounts(dimensions) {
    return Object.fromEntries(Object.entries(dimensions).map(([key, values]) => [key, values.length]));
}

function hashSeed(seed) {
    const text = String(seed || 'AUTH-MATRIX-SEED');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function createPrng(seed) {
    let state = hashSeed(seed);
    return function next() {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(values, prng, preferredValues = []) {
    const weighted = values.flatMap((value) => preferredValues.includes(value) ? [value, value, value, value] : [value]);
    return weighted[Math.floor(prng() * weighted.length) % weighted.length];
}

function defaultCase(dimensions) {
    const safeValues = {
        userRoles: 'customer',
        accountStates: 'active',
        passwordCases: 'valid_password',
        emailCases: 'valid_email',
        tokenStates: 'valid_access_token',
        sessionStates: 'active_session',
        otpStates: 'correct_otp',
        deviceStates: 'known_device',
        rateLimitStates: 'normal_request',
        routeTypes: 'authenticated_customer_route',
        browserTypes: 'chrome',
        osTypes: 'windows',
        geoRiskStates: 'normal_location',
        fraudScoreLevels: 'very_low',
        paymentRiskStates: 'no_payment_action',
        apiVersions: 'v1',
        behavioralRiskStates: 'normal_behavior',
    };
    return Object.fromEntries(Object.keys(dimensions).map((key) => [key, safeValues[key] || dimensions[key][0]]));
}

function stableCaseKey(authCase) {
    return Object.keys(authCase)
        .sort()
        .map((key) => `${key}:${authCase[key]}`)
        .join('|');
}

function addCase(cases, seen, authCase, source = 'generated') {
    const key = stableCaseKey(authCase);
    if (seen.has(key)) return false;
    seen.add(key);
    cases.push({ ...authCase, __source: source });
    return true;
}

function addBoundaryCases(cases, seen, dimensions) {
    const base = defaultCase(dimensions);
    addCase(cases, seen, base, 'boundary_valid_baseline');
    for (const [dimensionName, values] of Object.entries(dimensions)) {
        const boundaryValues = RISK_VALUES[dimensionName]?.filter((value) => values.includes(value));
        for (const value of boundaryValues || []) {
            addCase(cases, seen, { ...base, [dimensionName]: value }, `boundary_${dimensionName}`);
        }
    }
}

function addPairwiseCases(cases, seen, dimensions) {
    const entries = Object.entries(dimensions);
    const base = defaultCase(dimensions);
    for (let left = 0; left < entries.length; left += 1) {
        for (let right = left + 1; right < entries.length; right += 1) {
            const [leftName, leftValues] = entries[left];
            const [rightName, rightValues] = entries[right];
            const selectedLeft = (RISK_VALUES[leftName] || leftValues).filter((value) => leftValues.includes(value)).slice(0, 3);
            const selectedRight = (RISK_VALUES[rightName] || rightValues).filter((value) => rightValues.includes(value)).slice(0, 3);
            for (const leftValue of selectedLeft.length ? selectedLeft : leftValues.slice(0, 1)) {
                for (const rightValue of selectedRight.length ? selectedRight : rightValues.slice(0, 1)) {
                    addCase(cases, seen, { ...base, [leftName]: leftValue, [rightName]: rightValue }, `pairwise_${leftName}_${rightName}`);
                }
            }
        }
    }
}

function generateAuthCases(options = {}) {
    const matrix = options.matrix || loadMatrix();
    const policy = options.policy || loadAutoExpandPolicy();
    const mode = options.mode || 'generated';
    const expansionLevel = options.expansionLevel || options.expand || MODE_EXPANSION_DEFAULTS[mode] || 'level_0_base';
    const dimensions = getDimensionsForLevel(matrix, policy, expansionLevel);
    const limit = Math.max(1, Number(options.limit || DEFAULT_LIMITS[mode] || DEFAULT_LIMITS.generated));
    const seed = options.seed || `AUTH-${mode.toUpperCase()}-${expansionLevel}`;
    const prng = createPrng(seed);
    const cases = [];
    const seen = new Set();

    addBoundaryCases(cases, seen, dimensions);
    addPairwiseCases(cases, seen, dimensions);

    while (cases.length < limit) {
        const authCase = {};
        for (const [dimensionName, values] of Object.entries(dimensions)) {
            authCase[dimensionName] = pick(values, prng, RISK_VALUES[dimensionName] || []);
        }
        addCase(cases, seen, authCase, 'seeded_random');
    }

    return {
        seed,
        mode,
        expansionLevel,
        dimensions,
        cases: cases.slice(0, limit),
        logicalCeiling: countDimensions(dimensions),
        recommendedExecutedTests: getExpansionLevel(policy, expansionLevel).recommendedExecutedTests,
    };
}

function routeAllowsRole(authCase) {
    const allowed = ROUTE_POLICY[authCase.routeTypes] || [];
    return allowed.includes(authCase.userRoles);
}

function evaluateAuthCase(authCase) {
    const reasons = [];
    const publicRoute = authCase.routeTypes === 'public_route';
    const invalidCredential =
        !['valid_password', 'unicode_password', 'special_char_password'].includes(authCase.passwordCases) ||
        !['valid_email', 'uppercase_email', 'mixedcase_email', 'leading_trailing_space', 'unicode_email'].includes(authCase.emailCases);
    const blockedAccount = ['unverified_email', 'disabled', 'locked', 'deleted', 'password_reset_required', 'mfa_required'].includes(authCase.accountStates);
    const invalidToken = !publicRoute && authCase.tokenStates !== 'valid_access_token';
    const invalidSession = !publicRoute && ['expired_session', 'logged_out_session', 'revoked_session', 'password_changed_session', 'reset_password_session'].includes(authCase.sessionStates);
    const otpBlocked = ['wrong_otp', 'expired_otp', 'reused_otp', 'missing_otp', 'too_many_attempts', 'otp_for_different_user'].includes(authCase.otpStates);
    const rateLimited = authCase.rateLimitStates !== 'normal_request';
    const deviceRisk = ['suspicious_device', 'vpn_like_ip', 'impossible_travel_pattern'].includes(authCase.deviceStates);
    const fraudRisk = ['high', 'critical'].includes(authCase.fraudScoreLevels);
    const behaviorRisk = ['bot_like_pattern', 'account_takeover_pattern'].includes(authCase.behavioralRiskStates);
    const paymentRisk = ['saved_card_access', 'checkout_attempt', 'refund_attempt', 'high_value_order'].includes(authCase.paymentRiskStates);
    const roleRejected = !publicRoute && !routeAllowsRole(authCase);

    if (invalidCredential) reasons.push('invalid_credentials');
    if (blockedAccount) reasons.push(`account_${authCase.accountStates}`);
    if (invalidToken) reasons.push(`token_${authCase.tokenStates}`);
    if (invalidSession) reasons.push(`session_${authCase.sessionStates}`);
    if (otpBlocked) reasons.push(`otp_${authCase.otpStates}`);
    if (rateLimited) reasons.push(`rate_limit_${authCase.rateLimitStates}`);
    if (deviceRisk) reasons.push(`device_${authCase.deviceStates}`);
    if (fraudRisk) reasons.push(`fraud_${authCase.fraudScoreLevels}`);
    if (behaviorRisk) reasons.push(`behavior_${authCase.behavioralRiskStates}`);
    if (paymentRisk) reasons.push(`payment_reauth_${authCase.paymentRiskStates}`);
    if (roleRejected) reasons.push(`forbidden_${authCase.userRoles}_to_${authCase.routeTypes}`);

    const requiresReauth = reasons.some((reason) => reason.startsWith('device_') || reason.startsWith('fraud_') || reason.startsWith('behavior_') || reason.startsWith('payment_reauth_'));
    const allowed = reasons.length === 0;
    const status = allowed ? 200 : requiresReauth ? 401 : roleRejected ? 403 : rateLimited ? 429 : 401;

    return {
        allowed,
        status,
        requiresReauth,
        reasons,
        expectedResponsePrivacy: {
            genericCredentialError: invalidCredential,
            forbiddenDoesNotRevealPolicy: roleRejected,
            sensitiveFieldsNeverReturned: ['password', 'passwordHash', 'resetToken', 'otp', 'refreshTokenHash'],
        },
    };
}

function assertAuthCase(authCase) {
    const evaluation = evaluateAuthCase(authCase);
    const invalidButAllowed = evaluation.allowed && evaluation.reasons.length > 0;
    if (invalidButAllowed) {
        const error = new Error('Generated auth case allowed an unsafe combination');
        error.authCase = authCase;
        error.evaluation = evaluation;
        throw error;
    }
    return evaluation;
}

function formatGeneratedFailure(error, meta = {}) {
    const authCase = error.authCase || {};
    const evaluation = error.evaluation || {};
    const lines = [
        'FAILED GENERATED AUTH CASE',
        '',
        'Expansion Level:',
        meta.expansionLevel || 'unknown',
        '',
        'Seed:',
        meta.seed || 'unknown',
        '',
        'Case:',
        ...Object.keys(authCase)
            .filter((key) => key !== '__source')
            .sort()
            .map((key) => `${key} = ${authCase[key]}`),
        '',
        'Expected:',
        'Unsafe combinations must be rejected, rate-limited, forbidden, or require reauthentication.',
        '',
        'Actual:',
        JSON.stringify(evaluation, null, 2),
        '',
        'Reproduce:',
        `npm run test:auth:generated -- --seed=${meta.seed || 'AUTH-REPLAY'} --expand=${meta.expansionLevel || 'level_0_base'}`,
    ];
    return lines.join('\n');
}

function buildCountReport(selectedExpansionLevel = 'level_0_base') {
    const matrix = loadMatrix();
    const policy = loadAutoExpandPolicy();
    const baseDimensions = getBaseDimensions(matrix);
    const baseLogicalCeiling = countDimensions(baseDimensions);
    const levels = {};
    for (const levelName of Object.keys(policy.levels)) {
        const levelDimensions = getDimensionsForLevel(matrix, policy, levelName);
        levels[levelName] = {
            enabledDimensions: policy.levels[levelName].enabledDimensions,
            dimensionCounts: getDimensionCounts(levelDimensions),
            logicalCeiling: Number(countDimensions(levelDimensions)),
            recommendedExecutedTests: policy.levels[levelName].recommendedExecutedTests,
        };
    }
    const selected = levels[selectedExpansionLevel];
    if (!selected) {
        throw new Error(`Unknown expansion level ${selectedExpansionLevel}`);
    }
    return {
        baseMatrix: {
            dimensionCounts: getDimensionCounts(baseDimensions),
            logicalCeiling: Number(baseLogicalCeiling),
        },
        expansionLevels: Object.fromEntries(Object.entries(levels).map(([levelName, level]) => [
            levelName,
            {
                enabledDimensions: level.enabledDimensions,
                logicalCeiling: level.logicalCeiling,
                recommendedExecutedTests: level.recommendedExecutedTests,
            },
        ])),
        selectedExpansionLevel,
        selectedExpansion: selected,
        executionPolicy: EXECUTION_POLICY,
        professionalClaim: 'This login architecture supports approximately 1.04 billion logical authentication/security combinations through an elastic generated test matrix. It executes optimized risk-based subsets during normal development and can increase test depth when higher-risk login, token, session, OTP, RBAC, recovery, or payment-security changes require stronger validation.',
    };
}

function writeGeneratedCount(report = buildCountReport()) {
    const persisted = {
        baseMatrix: report.baseMatrix,
        expansionLevels: report.expansionLevels,
        executionPolicy: report.executionPolicy,
        professionalClaim: report.professionalClaim,
    };
    fs.writeFileSync(GENERATED_COUNT_PATH, `${JSON.stringify(persisted, null, 2)}\n`);
    return persisted;
}

module.exports = {
    AUTO_EXPAND_POLICY_PATH,
    BASE_DIMENSION_KEYS,
    DEFAULT_LIMITS,
    EXECUTION_POLICY,
    GENERATED_COUNT_PATH,
    MATRIX_PATH,
    MODE_EXPANSION_DEFAULTS,
    RISK_VALUES,
    ROUTE_POLICY,
    assertAuthCase,
    buildCountReport,
    countDimensions,
    createPrng,
    evaluateAuthCase,
    formatGeneratedFailure,
    formatNumber,
    generateAuthCases,
    getBaseDimensions,
    getDimensionCounts,
    getDimensionsForLevel,
    getExpansionLevel,
    loadAutoExpandPolicy,
    loadMatrix,
    stableCaseKey,
    writeGeneratedCount,
};
