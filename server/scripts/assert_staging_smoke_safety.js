#!/usr/bin/env node
'use strict';

const path = require('path');

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const STAGING_VALUES = new Set(['stage', 'staging', 'smoke-staging']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const KNOWN_PRODUCTION_HOSTS = [
    'aurapilot.vercel.app',
    'aura-gateway.vercel.app',
    'aurapilot.netlify.app',
];

const PRODUCTION_TOKEN_PATTERN = /(^|[^a-z0-9])(prod|production|live)([^a-z0-9]|$)/i;

const parseArgs = (argv = []) => argv.reduce((acc, arg) => {
    if (!String(arg || '').startsWith('--')) return acc;
    const [rawKey, ...rawValue] = String(arg).slice(2).split('=');
    acc[rawKey] = rawValue.length > 0 ? rawValue.join('=') : 'true';
    return acc;
}, {});

const normalize = (value) => String(value === undefined || value === null ? '' : value).trim();
const normalizeLower = (value) => normalize(value).toLowerCase();

const isTruthy = (value) => TRUTHY.has(normalizeLower(value));

const isPlaceholder = (value) => {
    const normalized = normalize(value);
    return !normalized || /^<[^>]+>$/.test(normalized) || /^your[-_a-z0-9]*$/i.test(normalized);
};

const getUrlHost = (value) => {
    try {
        return new URL(normalize(value)).hostname.toLowerCase();
    } catch (error) {
        return '';
    }
};

const isLocalUrl = (value) => {
    const host = getUrlHost(value);
    return Boolean(host && LOCAL_HOSTS.has(host));
};

const isKnownProductionHost = (value) => {
    const host = getUrlHost(value);
    if (!host) return false;
    return KNOWN_PRODUCTION_HOSTS.some((knownHost) => host === knownHost || host.endsWith(`.${knownHost}`));
};

const looksProductionLike = (value) => {
    const normalized = normalize(value);
    if (!normalized) return false;
    return PRODUCTION_TOKEN_PATTERN.test(normalized)
        || isKnownProductionHost(normalized)
        || /\/aura\/prod(?:\/|$)/i.test(normalized)
        || /\bsk_live_/i.test(normalized)
        || /\bpk_live_/i.test(normalized)
        || /\brzp_live_/i.test(normalized);
};

const redactedSignal = (key, value) => {
    const normalized = normalize(value);
    if (!normalized) return `${key}=<empty>`;

    if (key.includes('URL') || key.includes('URI') || key.includes('ORIGIN') || key.includes('HOST')) {
        const host = getUrlHost(normalized);
        return `${key}=${host || '<set:non-url>'}`;
    }

    if (key.includes('PROJECT') || key.includes('ENV') || key.includes('MODE') || key.includes('PROVIDER')) {
        return `${key}=${normalized}`;
    }

    return `${key}=<set>`;
};

const extractFirebaseServiceAccountProject = (env) => {
    const raw = normalize(env.FIREBASE_SERVICE_ACCOUNT);
    if (!raw || isPlaceholder(raw)) return '';
    try {
        const parsed = JSON.parse(raw);
        return normalize(parsed.project_id);
    } catch (error) {
        return '';
    }
};

const collectProductionSignals = (env, keys) => keys
    .map((key) => ({ key, value: normalize(env[key]) }))
    .filter(({ value }) => value && looksProductionLike(value))
    .map(({ key, value }) => redactedSignal(key, value));

const hasExplicitStagingIntent = (env) => [
    env.SMOKE_TARGET_ENV,
    env.SMOKE_ENV,
    env.APP_ENV,
].some((value) => STAGING_VALUES.has(normalizeLower(value)));

const getFirebaseProjectSignals = (env) => [
    ['FIREBASE_PROJECT_ID', env.FIREBASE_PROJECT_ID],
    ['GOOGLE_CLOUD_PROJECT', env.GOOGLE_CLOUD_PROJECT],
    ['GCLOUD_PROJECT', env.GCLOUD_PROJECT],
    ['FIREBASE_SERVICE_ACCOUNT.project_id', extractFirebaseServiceAccountProject(env)],
].filter(([, value]) => normalize(value));

const paymentFailures = (env) => {
    const failures = [];
    const stripeSecret = normalize(env.STRIPE_SECRET_KEY);
    const stripePublishable = normalize(env.STRIPE_PUBLISHABLE_KEY);
    const razorpayKey = normalize(env.RAZORPAY_KEY_ID);

    if (stripeSecret && !isPlaceholder(stripeSecret) && !stripeSecret.startsWith('sk_test_')) {
        failures.push('STRIPE_SECRET_KEY must be a test key for staging smoke.');
    }
    if (stripePublishable && !isPlaceholder(stripePublishable) && !stripePublishable.startsWith('pk_test_')) {
        failures.push('STRIPE_PUBLISHABLE_KEY must be a test key for staging smoke.');
    }
    if (razorpayKey && !isPlaceholder(razorpayKey) && !razorpayKey.startsWith('rzp_test_')) {
        failures.push('RAZORPAY_KEY_ID must be a test key for staging smoke.');
    }

    return failures;
};

const evaluateStagingSmokeSafety = ({
    env = process.env,
    purpose = 'smoke',
} = {}) => {
    const normalizedPurpose = normalizeLower(purpose || 'smoke');
    const flowMode = normalizeLower(env.SMOKE_FLOW_MODE || 'public') || 'public';
    const baseUrl = normalize(env.SMOKE_BASE_URL || 'http://127.0.0.1:5000');
    const localPublicSmoke = normalizedPurpose === 'smoke' && flowMode === 'public' && isLocalUrl(baseUrl);
    const mutating = normalizedPurpose === 'bootstrap' || ['customer', 'full'].includes(flowMode);

    const failures = [];
    const warnings = [];

    if (!['bootstrap', 'smoke'].includes(normalizedPurpose)) {
        failures.push(`Unsupported smoke safety purpose: ${purpose || '(missing)'}`);
    }

    if (!['public', 'customer', 'full'].includes(flowMode)) {
        failures.push(`Unsupported SMOKE_FLOW_MODE: ${flowMode}`);
    }

    if (localPublicSmoke) {
        return {
            ok: failures.length === 0,
            purpose: normalizedPurpose,
            flowMode,
            baseUrlHost: getUrlHost(baseUrl),
            mutating: false,
            failures,
            warnings,
        };
    }

    if (!hasExplicitStagingIntent(env)) {
        failures.push('Set SMOKE_TARGET_ENV=staging before running smoke against external or mutating targets.');
    }

    if (mutating && !isTruthy(env.SMOKE_STAGING_ISOLATED)) {
        failures.push('Set SMOKE_STAGING_ISOLATED=true only after confirming Firebase, MongoDB, Redis, email/SMS, and payment resources are staging-only.');
    }

    const criticalKeys = [
        'SMOKE_BASE_URL',
        'MONGO_URI',
        'REDIS_URL',
        'CORS_ORIGIN',
        'APP_PUBLIC_URL',
        'AWS_FRONTEND_URL',
        'AURA_BACKEND_PUBLIC_HOST',
        'AWS_PARAMETER_STORE_PATH_PREFIX',
        'STRIPE_SECRET_KEY',
        'STRIPE_PUBLISHABLE_KEY',
        'RAZORPAY_KEY_ID',
    ];
    const productionSignals = collectProductionSignals(env, criticalKeys);
    const firebaseProductionSignals = getFirebaseProjectSignals(env)
        .filter(([, value]) => looksProductionLike(value))
        .map(([key, value]) => redactedSignal(key, value));

    if (productionSignals.length > 0 || firebaseProductionSignals.length > 0) {
        failures.push(`Refusing smoke run because production-like configuration was detected: ${[
            ...productionSignals,
            ...firebaseProductionSignals,
        ].join(', ')}`);
    }

    if (isKnownProductionHost(baseUrl)) {
        failures.push('SMOKE_BASE_URL points at a known production frontend/gateway host.');
    }

    if (mutating) {
        failures.push(...paymentFailures(env));

        if (!normalize(env.MONGO_URI)) {
            warnings.push('MONGO_URI is not set in the preflight environment; bootstrap may fail before reaching staging.');
        }
        if (!normalize(env.FIREBASE_PROJECT_ID) && !extractFirebaseServiceAccountProject(env)) {
            warnings.push('Firebase project id was not visible to preflight; bootstrap may fall back to local development Firebase settings.');
        }
    }

    return {
        ok: failures.length === 0,
        purpose: normalizedPurpose,
        flowMode,
        baseUrlHost: getUrlHost(baseUrl),
        mutating,
        failures,
        warnings,
    };
};

const runCli = () => {
    const serverRoot = path.resolve(__dirname, '..');
    require('dotenv').config({ path: path.join(serverRoot, '.env') });

    const args = parseArgs(process.argv.slice(2));
    const result = evaluateStagingSmokeSafety({
        env: process.env,
        purpose: args.purpose || 'smoke',
    });

    const level = result.ok ? 'pass' : 'fail';
    console.log(JSON.stringify({
        check: 'staging_smoke_safety',
        level,
        purpose: result.purpose,
        flowMode: result.flowMode,
        baseUrlHost: result.baseUrlHost,
        mutating: result.mutating,
        failures: result.failures,
        warnings: result.warnings,
    }, null, 2));

    if (!result.ok) {
        process.exitCode = 1;
    }
};

if (require.main === module) {
    runCli();
}

module.exports = {
    __testables: {
        evaluateStagingSmokeSafety,
        hasExplicitStagingIntent,
        isLocalUrl,
        looksProductionLike,
    },
};
