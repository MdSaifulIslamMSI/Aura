const fs = require('fs');
const path = require('path');

const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');
const awsComposePath = path.join(repoRoot, 'infra', 'aws', 'docker-compose.ec2.yml');
const awsSecretsExamplePath = path.join(serverRoot, '.env.aws-secrets.example');

const RUNTIME_DIRECTORIES = [
    path.join(serverRoot, 'config'),
    path.join(serverRoot, 'controllers'),
    path.join(serverRoot, 'middleware'),
    path.join(serverRoot, 'models'),
    path.join(serverRoot, 'routes'),
    path.join(serverRoot, 'services'),
    path.join(serverRoot, 'utils'),
];

const RUNTIME_FILES = [
    path.join(serverRoot, 'index.js'),
    path.join(serverRoot, 'workerProcess.js'),
];

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

const EXPLICIT_SECRET_NAMES = new Set([
    ...DEFAULT_AWS_PARAMETER_KEYS,
]);

const NON_SECRET_RUNTIME_ENV_NAMES = new Set([
    'AI_INTERNAL_AUTH_ALLOW_LEGACY_SECRET',
]);

const EXCLUDED_PATH_FRAGMENTS = [
    `${path.sep}node_modules${path.sep}`,
    `${path.sep}coverage${path.sep}`,
    `${path.sep}.cache${path.sep}`,
    `${path.sep}dist${path.sep}`,
    `${path.sep}build${path.sep}`,
    `${path.sep}generated${path.sep}`,
    `${path.sep}tests${path.sep}`,
];

const ENV_VAR_PATTERN = /process\.env\.([A-Z0-9_]+)/g;
const ENABLED_TRUSTED_DEVICE_MODES = new Set([
    'always',
    'admin',
    'seller',
    'privileged',
]);

const isExcludedPath = (filePath) => EXCLUDED_PATH_FRAGMENTS.some((fragment) => filePath.includes(fragment));

const walkFiles = (targetPath, results = []) => {
    if (!fs.existsSync(targetPath)) {
        return results;
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
            walkFiles(path.join(targetPath, entry.name), results);
        }
        return results;
    }

    if (!isExcludedPath(targetPath)) {
        results.push(targetPath);
    }
    return results;
};

const extractRuntimeEnvNames = () => {
    const names = new Set();
    const files = [
        ...RUNTIME_DIRECTORIES.flatMap((directory) => walkFiles(directory)),
        ...RUNTIME_FILES.filter((filePath) => fs.existsSync(filePath)),
    ];

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        for (const match of content.matchAll(ENV_VAR_PATTERN)) {
            names.add(match[1]);
        }
    }

    return [...names].sort();
};

const isSecretLikeEnvName = (name) => {
    if (NON_SECRET_RUNTIME_ENV_NAMES.has(name)) {
        return false;
    }

    if (EXPLICIT_SECRET_NAMES.has(name)) {
        return true;
    }

    return (
        /(^|_)(SECRET|TOKEN|PASSWORD)$/.test(name)
        || /(^|_)API_KEY$/.test(name)
        || /(^|_)PRIVATE_KEY$/.test(name)
        || /(^|_)CONNECTION_STRING$/.test(name)
        || /_URI$/.test(name)
        || /_WEBHOOK_SECRET$/.test(name)
        || /_SERVICE_ACCOUNT$/.test(name)
        || /_KEY_SECRET$/.test(name)
        || /_PREVIOUS_SECRETS$/.test(name)
    );
};

const parseEnvFile = (filePath) => {
    const entries = new Map();
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
            continue;
        }
        const separatorIndex = trimmed.indexOf('=');
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1);
        entries.set(key, value);
    }
    return entries;
};

const parseAwsKeyListFromEnvExample = (envEntries) => {
    const secretKeys = envEntries.get('AWS_PARAMETER_STORE_SECRET_KEYS') || '';
    return new Set(
        String(secretKeys)
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
    );
};

const stripInlineComment = (value = '') => String(value || '').replace(/\s+#.*$/, '').trim();

const unquote = (value = '') => {
    const normalized = stripInlineComment(value);
    if (
        (normalized.startsWith('"') && normalized.endsWith('"'))
        || (normalized.startsWith('\'') && normalized.endsWith('\''))
    ) {
        return normalized.slice(1, -1).trim();
    }
    return normalized;
};

const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractDockerComposeEnvironmentValue = (filePath, envName) => {
    if (!fs.existsSync(filePath)) {
        return '';
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const match = raw.match(new RegExp(`^\\s+${escapeRegExp(envName)}:\\s*(.+)$`, 'm'));
    return match ? unquote(match[1]) : '';
};

const runtimeEnvNames = extractRuntimeEnvNames();
const runtimeSecretEnvNames = runtimeEnvNames.filter(isSecretLikeEnvName);

const envExampleEntries = parseEnvFile(path.join(serverRoot, '.env.example'));
const awsKeyList = parseAwsKeyListFromEnvExample(envExampleEntries);
const awsSecretsExampleExists = fs.existsSync(awsSecretsExamplePath);
const awsSecretsExampleEntries = awsSecretsExampleExists
    ? parseEnvFile(awsSecretsExamplePath)
    : new Map();
const envExampleTrustedDeviceMode = String(envExampleEntries.get('AUTH_DEVICE_CHALLENGE_MODE') || '').trim().toLowerCase();
const awsComposeTrustedDeviceMode = String(
    extractDockerComposeEnvironmentValue(awsComposePath, 'AUTH_DEVICE_CHALLENGE_MODE')
).trim().toLowerCase();
const awsTrustedDeviceModeIssues = [];

if (!ENABLED_TRUSTED_DEVICE_MODES.has(envExampleTrustedDeviceMode)) {
    awsTrustedDeviceModeIssues.push(
        `server/.env.example must keep AUTH_DEVICE_CHALLENGE_MODE enabled; found "${envExampleTrustedDeviceMode || '(missing)'}"`
    );
}

if (!ENABLED_TRUSTED_DEVICE_MODES.has(awsComposeTrustedDeviceMode)) {
    awsTrustedDeviceModeIssues.push(
        `infra/aws/docker-compose.ec2.yml must keep AUTH_DEVICE_CHALLENGE_MODE enabled; found "${awsComposeTrustedDeviceMode || '(missing)'}"`
    );
}

if (
    ENABLED_TRUSTED_DEVICE_MODES.has(envExampleTrustedDeviceMode)
    && ENABLED_TRUSTED_DEVICE_MODES.has(awsComposeTrustedDeviceMode)
    && envExampleTrustedDeviceMode !== awsComposeTrustedDeviceMode
) {
    awsTrustedDeviceModeIssues.push(
        `AUTH_DEVICE_CHALLENGE_MODE must match between server/.env.example (${envExampleTrustedDeviceMode}) and infra/aws/docker-compose.ec2.yml (${awsComposeTrustedDeviceMode})`
    );
}

const report = {
    runtimeSecretEnvVars: runtimeSecretEnvNames,
    missingFromEnvExample: runtimeSecretEnvNames.filter((name) => !envExampleEntries.has(name)),
    missingFromAwsParameterStoreSecretKeys: runtimeSecretEnvNames.filter((name) => !awsKeyList.has(name)),
    missingFromRuntimeBootstrapDefaults: runtimeSecretEnvNames.filter((name) => !DEFAULT_AWS_PARAMETER_KEYS.includes(name)),
    missingAwsSecretsExampleFile: awsSecretsExampleExists ? [] : ['server/.env.aws-secrets.example'],
    missingFromAwsSecretsExample: awsSecretsExampleExists
        ? [...awsKeyList].filter((name) => !awsSecretsExampleEntries.has(name))
        : [...awsKeyList],
    awsTrustedDeviceModeValues: {
        envExample: envExampleTrustedDeviceMode || null,
        awsCompose: awsComposeTrustedDeviceMode || null,
    },
    awsTrustedDeviceModeIssues,
};

const failureCount = Object.entries(report)
    .filter(([key]) => !['runtimeSecretEnvVars', 'awsTrustedDeviceModeValues'].includes(key))
    .reduce((total, [, values]) => total + (Array.isArray(values) ? values.length : 0), 0);

console.log(JSON.stringify(report, null, 2));

if (failureCount > 0) {
    process.exitCode = 1;
}
