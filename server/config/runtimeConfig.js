const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DEFAULT_AZURE_SECRET_KEYS = [
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
    'AZURE_STORAGE_CONNECTION_STRING',
    'AI_INTERNAL_TOOL_SECRET',
];

let localEnvLoaded = false;
let azureSecretsPrimed = false;
let azurePrimeResult = {
    enabled: false,
    source: 'local_env_only',
    loadedKeys: [],
    skippedKeys: [],
    keyVaultUrl: '',
    keyVaultName: '',
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
        path.join(serverRoot, '.env.azure-secrets'),
        path.join(serverRoot, '.env'),
    ];

    const loadedFiles = envCandidates.filter((candidate) => loadEnvFile(candidate));
    localEnvLoaded = true;
    return {
        loaded: true,
        files: loadedFiles,
    };
};

const resolveKeyVaultUrl = () => {
    const explicitUrl = safeString(process.env.AZURE_KEY_VAULT_URL || '');
    if (explicitUrl) return explicitUrl.replace(/\/+$/, '');

    const vaultName = safeString(process.env.AZURE_KEY_VAULT_NAME || '');
    if (!vaultName) return '';
    return `https://${vaultName}.vault.azure.net`;
};

const resolveSecretMap = () => {
    const raw = safeString(process.env.AZURE_KEY_VAULT_SECRET_MAP || '');
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        throw new Error(`azure_key_vault_secret_map_invalid:${error.message}`);
    }
};

const resolveSecretKeys = () => uniq([
    ...DEFAULT_AZURE_SECRET_KEYS,
    ...safeString(process.env.AZURE_KEY_VAULT_SECRET_KEYS || '').split(','),
]);

const resolveSecretNameForEnv = (envName = '', secretMap = {}) => {
    const normalizedEnvName = safeString(envName);
    if (!normalizedEnvName) return '';
    if (safeString(secretMap[normalizedEnvName])) {
        return safeString(secretMap[normalizedEnvName]);
    }
    return normalizedEnvName.toLowerCase().replace(/_/g, '-');
};

const isKeyVaultReferencePlaceholder = (value = '') => {
    const normalized = safeString(value);
    if (!normalized) return false;
    return normalized.startsWith('@Microsoft.KeyVault(') || normalized.startsWith('kv:');
};

const shouldResolveSecretValue = (value = '') => {
    const normalized = safeString(value);
    if (!normalized) return true;
    return isKeyVaultReferencePlaceholder(normalized);
};

const parseExplicitSecretReference = (value = '', fallbackSecretName = '') => {
    const normalized = safeString(value);
    if (!normalized) return fallbackSecretName;

    if (normalized.startsWith('kv:')) {
        return safeString(normalized.slice(3), fallbackSecretName);
    }

    const keyVaultMatch = normalized.match(/SecretName=([^;)]+)/i);
    if (keyVaultMatch?.[1]) {
        return safeString(keyVaultMatch[1], fallbackSecretName);
    }

    return fallbackSecretName;
};

const primeAzureKeyVaultEnv = async ({ logger = console } = {}) => {
    loadLocalEnvFiles();

    if (azureSecretsPrimed) {
        return azurePrimeResult;
    }

    const explicitKeyVaultFlag = safeString(process.env.AZURE_KEY_VAULT_ENABLED || '');
    const keyVaultEnabled = explicitKeyVaultFlag
        ? parseBoolean(explicitKeyVaultFlag, false)
        : Boolean(resolveKeyVaultUrl());

    if (!keyVaultEnabled) {
        azureSecretsPrimed = true;
        azurePrimeResult = {
            enabled: false,
            source: 'local_env_only',
            loadedKeys: [],
            skippedKeys: [],
            keyVaultUrl: '',
            keyVaultName: safeString(process.env.AZURE_KEY_VAULT_NAME || ''),
        };
        return azurePrimeResult;
    }

    const keyVaultUrl = resolveKeyVaultUrl();
    if (!keyVaultUrl) {
        throw new Error('azure_key_vault_url_missing');
    }

    const { DefaultAzureCredential } = require('@azure/identity');
    const { SecretClient } = require('@azure/keyvault-secrets');

    const secretMap = resolveSecretMap();
    const credentialOptions = {};
    const managedIdentityClientId = safeString(
        process.env.AZURE_KEY_VAULT_CLIENT_ID
        || process.env.AZURE_MANAGED_IDENTITY_CLIENT_ID
        || process.env.AZURE_CLIENT_ID
        || ''
    );
    if (managedIdentityClientId) {
        credentialOptions.managedIdentityClientId = managedIdentityClientId;
    }

    const credential = new DefaultAzureCredential(credentialOptions);
    const client = new SecretClient(keyVaultUrl, credential);
    const loadedKeys = [];
    const skippedKeys = [];
    const secretKeys = resolveSecretKeys();

    for (const envName of secretKeys) {
        const currentValue = safeString(process.env[envName] || '');
        if (!shouldResolveSecretValue(currentValue)) {
            skippedKeys.push(envName);
            continue;
        }

        const inferredSecretName = resolveSecretNameForEnv(envName, secretMap);
        const secretName = parseExplicitSecretReference(currentValue, inferredSecretName);
        if (!secretName) {
            skippedKeys.push(envName);
            continue;
        }

        const secret = await client.getSecret(secretName);
        const secretValue = safeString(secret?.value || '');
        if (!secretValue) {
            skippedKeys.push(envName);
            continue;
        }

        process.env[envName] = secretValue;
        loadedKeys.push(envName);
    }

    azureSecretsPrimed = true;
    azurePrimeResult = {
        enabled: true,
        source: 'azure_key_vault',
        loadedKeys,
        skippedKeys,
        keyVaultUrl,
        keyVaultName: safeString(process.env.AZURE_KEY_VAULT_NAME || ''),
    };

    logger?.info?.('runtime.azure_key_vault_primed', {
        source: azurePrimeResult.source,
        keyVaultUrl,
        loadedKeyCount: loadedKeys.length,
        skippedKeyCount: skippedKeys.length,
    });

    return azurePrimeResult;
};

const getAzureKeyVaultBootstrapState = () => ({
    ...azurePrimeResult,
    enabled: Boolean(azurePrimeResult.enabled),
});

module.exports = {
    DEFAULT_AZURE_SECRET_KEYS,
    getAzureKeyVaultBootstrapState,
    loadLocalEnvFiles,
    primeAzureKeyVaultEnv,
    __testables: {
        isKeyVaultReferencePlaceholder,
        parseExplicitSecretReference,
        resolveKeyVaultUrl,
        resolveSecretKeys,
        resolveSecretMap,
        resolveSecretNameForEnv,
        shouldResolveSecretValue,
    },
};
