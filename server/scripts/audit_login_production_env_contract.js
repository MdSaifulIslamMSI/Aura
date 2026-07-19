#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');

const paths = {
    awsCompose: path.join(repoRoot, 'infra', 'aws', 'docker-compose.ec2.yml'),
    caddyfile: path.join(repoRoot, 'infra', 'aws', 'Caddyfile'),
    bootstrapFreeTier: path.join(repoRoot, 'infra', 'aws', 'bootstrap-free-tier.ps1'),
    bootstrapGithubOidc: path.join(repoRoot, 'infra', 'aws', 'bootstrap-github-oidc.ps1'),
    bootstrapSecurityPosture: path.join(repoRoot, 'infra', 'aws', 'bootstrap-security-posture.ps1'),
    bootstrapUserData: path.join(repoRoot, 'infra', 'aws', 'bootstrap-instance-user-data.sh'),
    deployRelease: path.join(repoRoot, 'infra', 'aws', 'deploy-release.sh'),
    rollbackBackend: path.join(repoRoot, 'infra', 'aws', 'rollback-backend.sh'),
    renderRuntimeSecrets: path.join(repoRoot, 'infra', 'aws', 'render-runtime-secrets.sh'),
    envExample: path.join(serverRoot, '.env.example'),
    awsSecretsExample: path.join(serverRoot, '.env.aws-secrets.example'),
    serverIndex: path.join(serverRoot, 'index.js'),
    corsFlags: path.join(serverRoot, 'config', 'corsFlags.js'),
    redisConfig: path.join(serverRoot, 'config', 'redis.js'),
    browserSessionService: path.join(serverRoot, 'services', 'browserSessionService.js'),
    authRiskSignalService: path.join(serverRoot, 'services', 'authRiskSignalService.js'),
    authRiskSignalProducerMiddleware: path.join(serverRoot, 'middleware', 'authRiskSignalProducerMiddleware.js'),
    rootVercelConfig: path.join(repoRoot, 'vercel.json'),
    appVercelConfig: path.join(repoRoot, 'app', 'vercel.json'),
    netlifyConfig: path.join(repoRoot, 'netlify.toml'),
    appIndex: path.join(repoRoot, 'app', 'index.html'),
    vercelRoutingContract: path.join(repoRoot, 'app', 'config', 'vercelRoutingContract.mjs'),
};

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');
const missingFiles = Object.entries(paths)
    .filter(([, filePath]) => !fs.existsSync(filePath))
    .map(([name, filePath]) => `${name}: ${path.relative(repoRoot, filePath)}`);

const failures = [];
const warnings = [];

const addFailure = (message) => failures.push(message);
const addWarning = (message) => warnings.push(message);

const stripInlineComment = (value = '') => String(value || '').replace(/\s+#.*$/, '').trim();
const unquote = (value = '') => {
    const normalized = stripInlineComment(value).trim();
    if (
        (normalized.startsWith('"') && normalized.endsWith('"'))
        || (normalized.startsWith('\'') && normalized.endsWith('\''))
    ) {
        return normalized.slice(1, -1).trim();
    }
    return normalized;
};

const parseEnvLines = (content = '') => {
    const entries = new Map();
    for (const rawLine of String(content || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const separatorIndex = line.indexOf('=');
        const key = line.slice(0, separatorIndex).trim();
        const value = unquote(line.slice(separatorIndex + 1));
        if (key) entries.set(key, value);
    }
    return entries;
};

const extractBaseEnvFromUserData = (content = '') => {
    const match = String(content || '').match(/cat\s+>\s+\/opt\/aura\/shared\/base\.env\s+<<'EOF'\r?\n([\s\S]*?)\r?\nEOF/);
    return match ? match[1] : '';
};

const parseList = (value = '') => String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const isFalsy = (value) => ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());

const requireEnvValue = (entries, key, expected, label) => {
    const actual = entries.get(key);
    if (actual !== expected) {
        addFailure(`${label} must set ${key}=${expected}; found ${actual || '(missing)'}`);
    }
};

const requireEnvPresent = (entries, key, label) => {
    if (!entries.has(key)) {
        addFailure(`${label} must define ${key}`);
    }
};

const requireTruthyEnv = (entries, key, label) => {
    const actual = entries.get(key);
    if (!isTruthy(actual)) {
        addFailure(`${label} must enable ${key}; found ${actual || '(missing)'}`);
    }
};

const requireNotFalsyEnv = (entries, key, label) => {
    const actual = entries.get(key);
    if (isFalsy(actual)) {
        addFailure(`${label} must not disable ${key}; found ${actual}`);
    }
};

const requireIncludes = (content, needle, message) => {
    if (!String(content || '').includes(needle)) {
        addFailure(message);
    }
};

const requireNotIncludes = (content, needle, message) => {
    if (String(content || '').includes(needle)) {
        addFailure(message);
    }
};

const requireRegex = (content, pattern, message) => {
    if (!pattern.test(String(content || ''))) {
        addFailure(message);
    }
};

const parseJson = (content, label) => {
    try {
        return JSON.parse(content);
    } catch (error) {
        addFailure(`${label} must be valid JSON: ${error.message}`);
        return null;
    }
};

const getHeaderMap = (headers = []) => {
    const entries = new Map();
    for (const header of Array.isArray(headers) ? headers : []) {
        if (header?.key) entries.set(String(header.key).toLowerCase(), String(header.value || ''));
    }
    return entries;
};

const requireFrontendHeaders = (config, label) => {
    const headers = Array.isArray(config?.headers) ? config.headers : [];
    const allRouteHeaders = headers.find((entry) => entry?.source === '/(.*)');
    if (!allRouteHeaders) {
        addFailure(`${label} must set security headers for all SPA routes.`);
        return;
    }

    const headerMap = getHeaderMap(allRouteHeaders.headers);
    const csp = headerMap.get('content-security-policy') || '';
    if (!csp.includes("frame-ancestors 'none'")) {
        addFailure(`${label} CSP header must include frame-ancestors 'none'.`);
    }
    if ((headerMap.get('x-frame-options') || '').toUpperCase() !== 'DENY') {
        addFailure(`${label} must set X-Frame-Options=DENY.`);
    }
    if ((headerMap.get('x-content-type-options') || '').toLowerCase() !== 'nosniff') {
        addFailure(`${label} must set X-Content-Type-Options=nosniff.`);
    }
    if ((headerMap.get('referrer-policy') || '').toLowerCase() !== 'no-referrer') {
        addFailure(`${label} must set Referrer-Policy=no-referrer.`);
    }
};

if (missingFiles.length > 0) {
    for (const file of missingFiles) addFailure(`Missing production contract file: ${file}`);
}

const awsCompose = fs.existsSync(paths.awsCompose) ? readText(paths.awsCompose) : '';
const caddyfile = fs.existsSync(paths.caddyfile) ? readText(paths.caddyfile) : '';
const bootstrapFreeTier = fs.existsSync(paths.bootstrapFreeTier) ? readText(paths.bootstrapFreeTier) : '';
const bootstrapGithubOidc = fs.existsSync(paths.bootstrapGithubOidc) ? readText(paths.bootstrapGithubOidc) : '';
const bootstrapSecurityPosture = fs.existsSync(paths.bootstrapSecurityPosture) ? readText(paths.bootstrapSecurityPosture) : '';
const bootstrapUserData = fs.existsSync(paths.bootstrapUserData) ? readText(paths.bootstrapUserData) : '';
const deployRelease = fs.existsSync(paths.deployRelease) ? readText(paths.deployRelease) : '';
const rollbackBackend = fs.existsSync(paths.rollbackBackend) ? readText(paths.rollbackBackend) : '';
const renderRuntimeSecrets = fs.existsSync(paths.renderRuntimeSecrets) ? readText(paths.renderRuntimeSecrets) : '';
const envExample = fs.existsSync(paths.envExample) ? readText(paths.envExample) : '';
const awsSecretsExample = fs.existsSync(paths.awsSecretsExample) ? readText(paths.awsSecretsExample) : '';
const serverIndex = fs.existsSync(paths.serverIndex) ? readText(paths.serverIndex) : '';
const corsFlags = fs.existsSync(paths.corsFlags) ? readText(paths.corsFlags) : '';
const redisConfig = fs.existsSync(paths.redisConfig) ? readText(paths.redisConfig) : '';
const browserSessionService = fs.existsSync(paths.browserSessionService) ? readText(paths.browserSessionService) : '';
const authRiskSignalService = fs.existsSync(paths.authRiskSignalService) ? readText(paths.authRiskSignalService) : '';
const authRiskSignalProducerMiddleware = fs.existsSync(paths.authRiskSignalProducerMiddleware) ? readText(paths.authRiskSignalProducerMiddleware) : '';
const rootVercelConfig = fs.existsSync(paths.rootVercelConfig) ? readText(paths.rootVercelConfig) : '';
const appVercelConfig = fs.existsSync(paths.appVercelConfig) ? readText(paths.appVercelConfig) : '';
const netlifyConfig = fs.existsSync(paths.netlifyConfig) ? readText(paths.netlifyConfig) : '';
const appIndex = fs.existsSync(paths.appIndex) ? readText(paths.appIndex) : '';
const vercelRoutingContract = fs.existsSync(paths.vercelRoutingContract) ? readText(paths.vercelRoutingContract) : '';

const baseEnvContent = extractBaseEnvFromUserData(bootstrapUserData);
const baseEnv = parseEnvLines(baseEnvContent);
const envExampleEntries = parseEnvLines(envExample);
const awsSecretsExampleEntries = parseEnvLines(awsSecretsExample);
const awsParameterStoreSecretKeys = new Set(parseList(envExampleEntries.get('AWS_PARAMETER_STORE_SECRET_KEYS')));

if (!baseEnvContent) {
    addFailure('infra/aws/bootstrap-instance-user-data.sh must define /opt/aura/shared/base.env');
}

requireEnvValue(baseEnv, 'NODE_ENV', 'production', 'AWS base.env');
requireTruthyEnv(baseEnv, 'SPLIT_RUNTIME_ENABLED', 'AWS base.env');
requireTruthyEnv(baseEnv, 'REDIS_ENABLED', 'AWS base.env');
requireTruthyEnv(baseEnv, 'REDIS_REQUIRED', 'AWS base.env');
requireEnvValue(baseEnv, 'REDIS_URL', 'redis://redis:6379', 'AWS base.env');
requireEnvPresent(baseEnv, 'AUTH_RISK_IP_DENYLIST', 'AWS base.env');
requireEnvPresent(baseEnv, 'AUTH_RISK_IP_WATCHLIST', 'AWS base.env');
requireTruthyEnv(baseEnv, 'AUTH_SESSION_COOKIE_SECURE', 'AWS base.env');
requireEnvValue(baseEnv, 'AUTH_SESSION_ALLOW_MEMORY_FALLBACK', 'false', 'AWS base.env');
requireNotFalsyEnv(baseEnv, 'DISTRIBUTED_SECURITY_CONTROLS_ENABLED', 'AWS base.env');

const sameSite = String(baseEnv.get('AUTH_SESSION_SAME_SITE') || '').trim().toLowerCase();
if (!['lax', 'strict', 'none'].includes(sameSite)) {
    addFailure(`AWS base.env must set AUTH_SESSION_SAME_SITE to lax, strict, or none; found ${sameSite || '(missing)'}`);
}
if (sameSite === 'none' && !isTruthy(baseEnv.get('AUTH_SESSION_COOKIE_SECURE'))) {
    addFailure('AWS base.env cannot use SameSite=None without AUTH_SESSION_COOKIE_SECURE=true');
}

const corsOrigins = parseList(baseEnv.get('CORS_ORIGIN'));
if (corsOrigins.length === 0) {
    addFailure('AWS base.env must set CORS_ORIGIN to the deployed frontend origins');
}
for (const origin of corsOrigins) {
    if (origin === '*') {
        addFailure('AWS base.env CORS_ORIGIN must not include wildcard (*)');
        continue;
    }
    if (/localhost|127\.0\.0\.1|\[?::1\]?/i.test(origin)) {
        addFailure(`AWS base.env CORS_ORIGIN must not include local development origin ${origin}`);
    }
    if (!/^https:\/\//i.test(origin)) {
        addFailure(`AWS base.env CORS_ORIGIN must use https origins in production; found ${origin}`);
    }
}

const publicUrl = String(baseEnv.get('APP_PUBLIC_URL') || '').trim();
if (!/^https:\/\//i.test(publicUrl)) {
    addFailure(`AWS base.env APP_PUBLIC_URL must be an https URL; found ${publicUrl || '(missing)'}`);
}

const webAuthnOrigin = String(baseEnv.get('AUTH_WEBAUTHN_ORIGIN') || '').trim();
const webAuthnRpId = String(baseEnv.get('AUTH_WEBAUTHN_RP_ID') || '').trim().toLowerCase();
let publicUrlHost = '';
try {
    const parsedPublicUrl = new URL(publicUrl);
    publicUrlHost = parsedPublicUrl.hostname.toLowerCase();
    if (parsedPublicUrl.origin !== publicUrl) {
        addFailure('AWS base.env APP_PUBLIC_URL must be an origin without path, query, or fragment');
    }
} catch {
    // The HTTPS validation above already records the malformed public URL.
}
if (webAuthnOrigin !== publicUrl) {
    addFailure('AWS base.env AUTH_WEBAUTHN_ORIGIN must match APP_PUBLIC_URL for production passkeys');
}
if (!publicUrlHost || webAuthnRpId !== publicUrlHost) {
    addFailure('AWS base.env AUTH_WEBAUTHN_RP_ID must match the APP_PUBLIC_URL hostname');
}
requireEnvValue(baseEnv, 'AUTH_WEBAUTHN_USER_VERIFICATION', 'required', 'AWS base.env');
requireTruthyEnv(baseEnv, 'MFA_ENABLED', 'AWS base.env');
requireTruthyEnv(baseEnv, 'MFA_PASSKEY_ENABLED', 'AWS base.env');
requireEnvValue(baseEnv, 'AURA_DESKTOP_OWNER_ACCESS_ENABLED', 'false', 'AWS base.env');

const backendPublicHost = String(baseEnv.get('AURA_BACKEND_PUBLIC_HOST') || '').trim();
if (!/^[a-z0-9.-]+$/i.test(backendPublicHost)) {
    addFailure(`AWS base.env must set AURA_BACKEND_PUBLIC_HOST to the public TLS backend host; found ${backendPublicHost || '(missing)'}`);
}

requireIncludes(awsCompose, 'redis:', 'AWS Compose must define a redis service for login/session persistence.');
requireIncludes(awsCompose, 'edge:', 'AWS Compose must define a TLS edge service in front of the API.');
requireIncludes(awsCompose, 'caddy:2-alpine', 'AWS TLS edge must use the Caddy container for automatic certificates.');
requireRegex(awsCompose, /api:[\s\S]*depends_on:[\s\S]*-\s+redis/, 'AWS API service must depend on redis.');
requireRegex(awsCompose, /worker:[\s\S]*depends_on:[\s\S]*-\s+redis/, 'AWS worker service must depend on redis.');
requireIncludes(awsCompose, 'runtime-secrets.env', 'AWS Compose services must load runtime-secrets.env.');
requireIncludes(awsCompose, 'redis-server", "--appendonly", "yes"', 'AWS Redis service must enable appendonly persistence.');
requireRegex(awsCompose, /AUTH_DEVICE_CHALLENGE_MODE:\s*(admin|always)/, 'AWS API service must keep trusted-device mode enabled (admin or always).');
requireIncludes(awsCompose, 'ADMIN_REQUIRE_PASSKEY: "true"', 'AWS API service must require passkey-backed admin access.');
requireIncludes(awsCompose, 'MFA_ENABLED: "true"', 'AWS API service must keep the MFA subsystem enabled.');
requireIncludes(awsCompose, 'MFA_PASSKEY_ENABLED: "true"', 'AWS API service must keep passkey MFA enabled.');
requireIncludes(awsCompose, 'AURA_DESKTOP_OWNER_ACCESS_ENABLED: "false"', 'AWS API service must disable shared-key desktop owner access.');
requireIncludes(awsCompose, '"127.0.0.1:5000:5000"', 'AWS API port 5000 must bind to loopback only.');
if (/["']?5000:5000["']?/.test(awsCompose) && !awsCompose.includes('"127.0.0.1:5000:5000"')) {
    addFailure('AWS Compose must not publish API port 5000 on all interfaces.');
}
requireIncludes(awsCompose, '"80:80"', 'AWS TLS edge must publish HTTP port 80 for ACME challenges.');
requireIncludes(awsCompose, '"443:443"', 'AWS TLS edge must publish HTTPS port 443.');
requireIncludes(awsCompose, './Caddyfile:/etc/caddy/Caddyfile:ro', 'AWS TLS edge must mount the checked-in Caddyfile.');
requireIncludes(caddyfile, '{$AURA_BACKEND_PUBLIC_HOST}', 'Caddyfile must serve the configured public backend host.');
requireIncludes(caddyfile, 'reverse_proxy api:5000', 'Caddyfile must reverse proxy to the internal API container.');
requireIncludes(caddyfile, 'Strict-Transport-Security', 'Caddyfile must set HSTS for the backend TLS origin.');
requireIncludes(bootstrapUserData, 'AURA_BACKEND_PUBLIC_HOST=', 'AWS bootstrap base.env must define the public TLS backend host.');
requireIncludes(bootstrapFreeTier, 'FromPort"":80', 'AWS bootstrap security group must allow inbound port 80 for ACME.');
requireIncludes(bootstrapFreeTier, 'FromPort"":443', 'AWS bootstrap security group must allow inbound port 443 for HTTPS.');
requireIncludes(bootstrapFreeTier, 'revoke-security-group-ingress', 'AWS bootstrap must revoke legacy public port 5000 ingress.');
requireIncludes(bootstrapFreeTier, 'aws sts get-caller-identity', 'AWS bootstrap must resolve the current account before writing IAM policies.');
requireIncludes(bootstrapFreeTier, 'put-bucket-versioning', 'AWS bootstrap must enable S3 bucket versioning.');
requireIncludes(bootstrapFreeTier, 'NoncurrentVersionExpiration', 'AWS bootstrap lifecycle must expire noncurrent S3 versions.');
requireIncludes(bootstrapFreeTier, '""Encrypted"":true', 'AWS bootstrap must encrypt new EC2 root volumes.');
requireNotIncludes(bootstrapFreeTier, 'arn:aws:ssm:${Region}:*:parameter', 'AWS EC2 runtime role must not allow cross-account Parameter Store reads.');
requireIncludes(bootstrapFreeTier, 'parameter$normalizedParameterPrefix', 'AWS EC2 runtime role must scope Parameter Store reads to the exact runtime prefix.');
requireIncludes(bootstrapFreeTier, 'parameter$normalizedParameterPrefix/*', 'AWS EC2 runtime role must scope Parameter Store reads to children under the exact runtime prefix.');
requireIncludes(bootstrapGithubOidc, 'aws sts get-caller-identity', 'AWS GitHub OIDC bootstrap must resolve the current account before writing IAM policies.');
requireNotIncludes(bootstrapGithubOidc, 'arn:aws:ssm:${AwsRegion}:*:parameter', 'AWS GitHub OIDC role must not allow cross-account Parameter Store access.');
requireIncludes(bootstrapGithubOidc, 'parameter$normalizedParameterStorePathPrefix', 'AWS GitHub OIDC role must scope Parameter Store access to the exact runtime prefix.');
requireIncludes(bootstrapGithubOidc, 'parameter$normalizedParameterStorePathPrefix/*', 'AWS GitHub OIDC role must scope Parameter Store access to children under the exact runtime prefix.');
requireIncludes(bootstrapSecurityPosture, 'guardduty create-detector', 'AWS security posture bootstrap must enable GuardDuty.');
requireIncludes(bootstrapSecurityPosture, 'configservice put-configuration-recorder', 'AWS security posture bootstrap must configure AWS Config recording.');
requireIncludes(bootstrapSecurityPosture, 'configservice start-configuration-recorder', 'AWS security posture bootstrap must start AWS Config recording.');
requireIncludes(bootstrapSecurityPosture, 'ec2 create-flow-logs', 'AWS security posture bootstrap must enable backend VPC Flow Logs.');
requireIncludes(bootstrapSecurityPosture, 'logs put-retention-policy', 'AWS security posture bootstrap must set Flow Logs retention.');
requireIncludes(bootstrapSecurityPosture, 'BucketOwnerEnforced', 'AWS security posture bootstrap must enforce S3 bucket ownership controls.');

for (const [label, content] of [
    ['infra/aws/docker-compose.ec2.yml', awsCompose],
    ['infra/aws/deploy-release.sh', deployRelease],
    ['infra/aws/bootstrap-instance-user-data.sh', bootstrapUserData],
    ['server/scripts/start_api_runtime.js', fs.existsSync(path.join(serverRoot, 'scripts', 'start_api_runtime.js')) ? readText(path.join(serverRoot, 'scripts', 'start_api_runtime.js')) : ''],
    ['server/scripts/start_worker_runtime.js', fs.existsSync(path.join(serverRoot, 'scripts', 'start_worker_runtime.js')) ? readText(path.join(serverRoot, 'scripts', 'start_worker_runtime.js')) : ''],
]) {
    if (/--inspect(?:=|\b)/.test(content)) {
        addFailure(`${label} must not enable the Node inspector in production runtime paths.`);
    }
}

requireIncludes(renderRuntimeSecrets, '--with-decryption', 'Runtime secret rendering must decrypt AWS SSM SecureString values.');
requireIncludes(renderRuntimeSecrets, 'chmod 600 "${output_file}"', 'Runtime secret rendering must chmod runtime-secrets.env to 600.');
requireIncludes(renderRuntimeSecrets, 'invalid_parameter_names', 'Runtime secret rendering must reject invalid Parameter Store env names before writing runtime-secrets.env.');
requireIncludes(renderRuntimeSecrets, '^[A-Za-z_][A-Za-z0-9_]*$', 'Runtime secret rendering must require env-safe Parameter Store leaf names.');
requireIncludes(deployRelease, 'assert_trusted_device_runtime_contract', 'AWS deploy must enforce trusted-device runtime contract before compose up.');
requireIncludes(deployRelease, 'render-runtime-secrets.sh', 'AWS deploy must render runtime secrets before compose up.');
requireIncludes(deployRelease, 'AURA_BACKEND_PUBLIC_HOST', 'AWS deploy must validate the TLS edge host.');
requireIncludes(deployRelease, '--resolve "${backend_public_host}:443:127.0.0.1"', 'AWS deploy must validate HTTPS through the local TLS edge.');
requireIncludes(deployRelease, 'AURA_INFRA_BUNDLE_SHA256', 'AWS deploy must require an expected infra bundle SHA-256.');
requireIncludes(deployRelease, 'upsert_env_value "${staged_base_env}" "MFA_ENABLED" "true"', 'AWS deploy must persist MFA_ENABLED=true.');
requireIncludes(deployRelease, 'upsert_env_value "${staged_base_env}" "MFA_PASSKEY_ENABLED" "true"', 'AWS deploy must persist MFA_PASSKEY_ENABLED=true.');
requireIncludes(deployRelease, 'upsert_env_value "${staged_base_env}" "AURA_DESKTOP_OWNER_ACCESS_ENABLED" "false"', 'AWS deploy must persistently disable shared-key desktop owner access.');
requireIncludes(rollbackBackend, 'upsert_env_value "${staged_base_env}" "MFA_ENABLED" "true"', 'AWS rollback must preserve MFA_ENABLED=true.');
requireIncludes(rollbackBackend, 'upsert_env_value "${staged_base_env}" "MFA_PASSKEY_ENABLED" "true"', 'AWS rollback must preserve MFA_PASSKEY_ENABLED=true.');
requireIncludes(rollbackBackend, 'upsert_env_value "${staged_base_env}" "AURA_DESKTOP_OWNER_ACCESS_ENABLED" "false"', 'AWS rollback must preserve the shared-key owner-access shutdown.');
requireIncludes(deployRelease, 'AURA_IMAGE_BUNDLE_SHA256', 'AWS deploy must require an expected image bundle SHA-256.');
requireIncludes(deployRelease, 'verify_sha256 "${release_dir}/image.tar.gz"', 'AWS deploy must verify the image bundle before docker load.');

const requiredSecretKeys = [
    'MONGO_URI',
    'REDIS_URL',
    'FIREBASE_SERVICE_ACCOUNT',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'AUTH_VAULT_SECRET',
    'AUTH_DEVICE_CHALLENGE_SECRET',
    'AUTH_RECOVERY_CODE_SECRET',
    'AUTH_RISK_SIGNAL_SECRET',
    'AUTH_RISK_SIGNAL_PREVIOUS_SECRETS',
    'OTP_FLOW_SECRET',
    'OTP_CHALLENGE_SECRET',
    'CRON_SECRET',
    'METRICS_SECRET',
];

for (const key of requiredSecretKeys) {
    if (!awsParameterStoreSecretKeys.has(key)) {
        addFailure(`server/.env.example AWS_PARAMETER_STORE_SECRET_KEYS must include ${key}`);
    }
    if (!awsSecretsExampleEntries.has(key)) {
        addFailure(`server/.env.aws-secrets.example must include ${key}`);
    }
}

requireIncludes(serverIndex, "app.disable('x-powered-by')", 'Express app must disable x-powered-by.');
requireIncludes(serverIndex, "app.set('trust proxy', 1)", 'Express app must use explicit trust proxy count, not a broad trust proxy setting.');
requireIncludes(serverIndex, 'helmet({', 'Express app must install Helmet security headers.');
requireIncludes(serverIndex, 'credentials: true', 'CORS must explicitly support credentialed browser sessions only with allowlisted origins.');
requireIncludes(serverIndex, 'assertProductionCorsConfig();', 'Production startup must assert CORS configuration.');
requireIncludes(serverIndex, 'assertProductionRedisConfig();', 'Production startup must assert Redis configuration.');
requireIncludes(serverIndex, 'assertTrustedDeviceConfig();', 'Production startup must assert trusted-device configuration.');
requireIncludes(serverIndex, 'assertAuthRiskSignalConfig();', 'Production startup must assert login risk signal configuration.');
requireIncludes(serverIndex, 'authRiskSignalProducerMiddleware', 'Express app must install the login risk signal producer/stripper middleware.');
requireIncludes(corsFlags, 'CORS_ORIGIN cannot contain wildcard (*) in production', 'CORS config must reject wildcard production origins.');
requireIncludes(redisConfig, 'distributedSecurityControlsEnabled', 'Redis config must expose distributed security control requirement.');
requireIncludes(redisConfig, 'isRedisRequired', 'Redis config must compute production Redis requirement.');
requireRegex(browserSessionService, /AUTH_SESSION_COOKIE_SECURE[\s\S]*IS_PRODUCTION/, 'Browser session cookies must default to Secure in production.');
requireIncludes(browserSessionService, 'AUTH_SESSION_ALLOW_MEMORY_FALLBACK', 'Browser session service must keep production memory fallback explicit.');
requireIncludes(authRiskSignalService, 'crypto.createHmac', 'Login risk edge/server signals must be HMAC signed.');
requireIncludes(authRiskSignalService, 'AUTH_RISK_SIGNAL_SECRET is required when AUTH_RISK_ENGINE_MODE=enforce', 'Login risk enforcement must require a signing secret.');
requireIncludes(authRiskSignalProducerMiddleware, 'stripLoginRiskSignalHeaders', 'Login risk producer must strip spoofed client signal headers.');
requireIncludes(authRiskSignalProducerMiddleware, 'writeSignedLoginRiskSignalHeaders', 'Login risk producer must sign trusted server-side signals.');

const rootVercelJson = rootVercelConfig ? parseJson(rootVercelConfig, 'vercel.json') : null;
const appVercelJson = appVercelConfig ? parseJson(appVercelConfig, 'app/vercel.json') : null;
if (rootVercelJson) requireFrontendHeaders(rootVercelJson, 'vercel.json');
if (appVercelJson) requireFrontendHeaders(appVercelJson, 'app/vercel.json');
requireIncludes(netlifyConfig, 'Content-Security-Policy =', 'Netlify config must ship a CSP header for SPA routes.');
requireIncludes(netlifyConfig, "frame-ancestors 'none'", 'Netlify CSP header must deny framing.');
requireIncludes(netlifyConfig, 'X-Frame-Options = "DENY"', 'Netlify config must set X-Frame-Options=DENY.');
if (/http-equiv=["']Content-Security-Policy["'][\s\S]*frame-ancestors/i.test(appIndex)) {
    addFailure('app/index.html must not put frame-ancestors in a meta CSP; browsers ignore it there. Use deployment headers instead.');
}
requireIncludes(vercelRoutingContract, 'FRONTEND_SECURITY_HEADERS', 'Vercel routing contract must define shared frontend security headers.');
requireIncludes(vercelRoutingContract, 'assertDeployableHostedBackendOrigin', 'Hosted backend routing must reject non-deployable production origins.');
requireRegex(vercelRoutingContract, /DEFAULT_HOSTED_BACKEND_ORIGIN\s*=\s*['"]https:\/\//, 'Committed backend placeholder must be HTTPS.');
if (/DEFAULT_HOSTED_BACKEND_ORIGIN\s*=\s*['"]http:\/\//.test(vercelRoutingContract)) {
    addFailure('Committed backend placeholder must not be plain HTTP.');
}
if (/(http:\/\/3\.109\.181\.238:5000|13\.206\.172\.186\.sslip\.io)/.test(`${netlifyConfig}\n${rootVercelConfig}\n${appVercelConfig}`)) {
    addFailure('Frontend routing configs must not point production traffic at legacy single-host backend origins.');
}

if (baseEnv.get('AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK') !== 'true') {
    addWarning('AWS base.env does not keep AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK=true; verify AUTH_DEVICE_CHALLENGE_SECRET is always present.');
}

const report = {
    checkedFiles: Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, path.relative(repoRoot, filePath)])),
    awsBaseEnv: {
        corsOriginCount: corsOrigins.length,
        redisRequired: baseEnv.get('REDIS_REQUIRED') || null,
        sessionCookieSecure: baseEnv.get('AUTH_SESSION_COOKIE_SECURE') || null,
        sessionSameSite: sameSite || null,
        sessionMemoryFallback: baseEnv.get('AUTH_SESSION_ALLOW_MEMORY_FALLBACK') || null,
        webAuthnOrigin: webAuthnOrigin || null,
        webAuthnRpId: webAuthnRpId || null,
        distributedSecurityControls: baseEnv.get('DISTRIBUTED_SECURITY_CONTROLS_ENABLED') || '(production default)',
        backendPublicHost: backendPublicHost || null,
    },
    failures,
    warnings,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
    process.exitCode = 1;
}
