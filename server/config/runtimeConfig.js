const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DEFAULT_AWS_PARAMETER_KEYS = [
    'MONGO_URI',
    'REDIS_URL',
    'FIREBASE_SERVICE_ACCOUNT',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'AUTH_VAULT_SECRET',
    'AUTH_VAULT_PREVIOUS_SECRETS',
    'AUTH_DEVICE_CHALLENGE_SECRET',
    'AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS',
    'UPLOAD_SIGNING_SECRET',
    'OTP_FLOW_SECRET',
    'OTP_CHALLENGE_SECRET',
    'CRON_SECRET',
    'METRICS_SECRET',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'OPEN_EXCHANGE_RATES_APP_ID',
    'RESEND_API_KEY',
    'RESEND_WEBHOOK_SECRET',
    'GMAIL_APP_PASSWORD',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'TWILIO_WHATSAPP_FROM',
    'GEMINI_API_KEY',
    'GROQ_API_KEY',
    'VOYAGE_API_KEY',
    'ELEVENLABS_API_KEY',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'AI_INTERNAL_AUTH_SECRET',
    'AI_INTERNAL_AUTH_PREVIOUS_SECRETS',
    'AI_INTERNAL_TOOL_SECRET',
];

let localEnvLoaded = false;
let runtimeSecretsPrimed = false;
let runtimePrimeResult = {
    enabled: false,
    source: 'local_env_only',
    loadedKeys: [],
    skippedKeys: [],
    region: '',
    pathPrefix: '',
};

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const parseBoolean = (value, fallback = false) => {
    const normalized = safeString(value).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};
const uniq = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((entry) => safeString(entry)).filter(Boolean))];

const getServerRoot = () => path.resolve(__dirname, '..');

const loadEnvFile = (filePath = '') => {
    if (!filePath || !fs.existsSync(filePath)) {
        return false;
    }

    dotenv.config({ path: filePath });
    return true;
};

const loadLocalEnvFiles = () => {
    if (localEnvLoaded) {
        return {
            loaded: true,
            files: [],
        };
    }

    const serverRoot = getServerRoot();
    const envCandidates = [
        path.join(serverRoot, '.env.local'),
        path.join(serverRoot, '.env'),
    ];

    const loadedFiles = envCandidates.filter((candidate) => loadEnvFile(candidate));
    localEnvLoaded = true;
    return {
        loaded: true,
        files: loadedFiles,
    };
};

const resolveParameterStoreRegion = () => safeString(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '');

const resolveParameterStorePathPrefix = () => safeString(process.env.AWS_PARAMETER_STORE_PATH_PREFIX || '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

const resolveParameterStoreSecretMap = () => {
    const raw = safeString(process.env.AWS_PARAMETER_STORE_SECRET_MAP || '');
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        throw new Error(`aws_parameter_store_secret_map_invalid:${error.message}`);
    }
};

const resolveParameterStoreSecretKeys = () => uniq([
    ...DEFAULT_AWS_PARAMETER_KEYS,
    ...safeString(process.env.AWS_PARAMETER_STORE_SECRET_KEYS || '').split(','),
]);

const resolveParameterNameForEnv = (envName = '', secretMap = {}) => {
    const normalizedEnvName = safeString(envName);
    if (!normalizedEnvName) return '';
    if (safeString(secretMap[normalizedEnvName])) {
        return safeString(secretMap[normalizedEnvName]);
    }
    return normalizedEnvName;
};

const isParameterStoreReferencePlaceholder = (value = '') => {
    const normalized = safeString(value);
    if (!normalized) return false;
    return normalized.toLowerCase().startsWith('ssm:');
};

const shouldResolveSecretValue = (value = '') => {
    const normalized = safeString(value);
    if (!normalized) return true;
    return isParameterStoreReferencePlaceholder(normalized);
};

const parseExplicitParameterReference = (value = '', fallbackParameterName = '') => {
    const normalized = safeString(value);
    if (!normalized) return fallbackParameterName;

    if (normalized.toLowerCase().startsWith('ssm:')) {
        return safeString(normalized.slice(4), fallbackParameterName);
    }

    return fallbackParameterName;
};

const resolveParameterPath = (parameterName = '', pathPrefix = '') => {
    const normalizedParameterName = safeString(parameterName);
    if (!normalizedParameterName) return '';
    if (normalizedParameterName.startsWith('/')) {
        return normalizedParameterName;
    }

    const normalizedPrefix = safeString(pathPrefix)
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
    if (!normalizedPrefix) {
        return `/${normalizedParameterName}`;
    }

    return `/${normalizedPrefix}/${normalizedParameterName}`;
};

const primeAwsParameterStoreEnv = async ({ logger = console } = {}) => {
    loadLocalEnvFiles();

    if (runtimeSecretsPrimed) {
        return runtimePrimeResult;
    }

    const pathPrefix = resolveParameterStorePathPrefix();
    const region = resolveParameterStoreRegion();
    const explicitParameterStoreFlag = safeString(process.env.AWS_PARAMETER_STORE_ENABLED || '');
    const parameterStoreEnabled = explicitParameterStoreFlag
        ? parseBoolean(explicitParameterStoreFlag, false)
        : Boolean(pathPrefix);

    if (!parameterStoreEnabled) {
        runtimeSecretsPrimed = true;
        runtimePrimeResult = {
            enabled: false,
            source: 'local_env_only',
            loadedKeys: [],
            skippedKeys: [],
            region,
            pathPrefix,
        };
        return runtimePrimeResult;
    }

    if (!region) {
        throw new Error('aws_parameter_store_region_missing');
    }

    const { SSMClient, GetParametersCommand } = require('@aws-sdk/client-ssm');

    const secretMap = resolveParameterStoreSecretMap();
    const secretKeys = resolveParameterStoreSecretKeys();
    const envToParameterPath = new Map();
    const skippedKeys = [];

    for (const envName of secretKeys) {
        const currentValue = safeString(process.env[envName] || '');
        if (!shouldResolveSecretValue(currentValue)) {
            skippedKeys.push(envName);
            continue;
        }

        const inferredParameterName = resolveParameterNameForEnv(envName, secretMap);
        const parameterName = parseExplicitParameterReference(currentValue, inferredParameterName);
        const parameterPath = resolveParameterPath(parameterName, pathPrefix);
        if (!parameterPath) {
            skippedKeys.push(envName);
            continue;
        }

        envToParameterPath.set(envName, parameterPath);
    }

    const client = new SSMClient({ region });
    const parameterValueByName = new Map();
    const invalidParameters = new Set();
    const parameterPaths = [...new Set(envToParameterPath.values())];

    for (let index = 0; index < parameterPaths.length; index += 10) {
        const batch = parameterPaths.slice(index, index + 10);
        if (batch.length === 0) {
            continue;
        }

        const response = await client.send(new GetParametersCommand({
            Names: batch,
            WithDecryption: true,
        }));

        for (const parameter of response.Parameters || []) {
            parameterValueByName.set(String(parameter.Name || ''), safeString(parameter.Value || ''));
        }

        for (const invalidName of response.InvalidParameters || []) {
            invalidParameters.add(String(invalidName || ''));
        }
    }

    const loadedKeys = [];
    for (const [envName, parameterPath] of envToParameterPath.entries()) {
        if (invalidParameters.has(parameterPath)) {
            skippedKeys.push(envName);
            continue;
        }

        const parameterValue = safeString(parameterValueByName.get(parameterPath) || '');
        if (!parameterValue) {
            skippedKeys.push(envName);
            continue;
        }

        process.env[envName] = parameterValue;
        loadedKeys.push(envName);
    }

    runtimeSecretsPrimed = true;
    runtimePrimeResult = {
        enabled: true,
        source: 'aws_parameter_store',
        loadedKeys,
        skippedKeys: uniq(skippedKeys),
        region,
        pathPrefix,
    };

    logger?.info?.('runtime.aws_parameter_store_primed', {
        source: runtimePrimeResult.source,
        region,
        pathPrefix,
        loadedKeyCount: loadedKeys.length,
        skippedKeyCount: runtimePrimeResult.skippedKeys.length,
    });

    return runtimePrimeResult;
};

const getRuntimeSecretBootstrapState = () => ({
    ...runtimePrimeResult,
    enabled: Boolean(runtimePrimeResult.enabled),
});

module.exports = {
    DEFAULT_AWS_PARAMETER_KEYS,
    getRuntimeSecretBootstrapState,
    loadLocalEnvFiles,
    primeAwsParameterStoreEnv,
    __testables: {
        isParameterStoreReferencePlaceholder,
        parseExplicitParameterReference,
        resolveParameterNameForEnv,
        resolveParameterPath,
        resolveParameterStorePathPrefix,
        resolveParameterStoreSecretKeys,
        resolveParameterStoreSecretMap,
        resolveParameterStoreRegion,
        shouldResolveSecretValue,
    },
};
