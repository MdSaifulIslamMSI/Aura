import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  KEYCLOAK_REQUIRED_ENV,
  normalizeProvider,
  resolveAuthEnvironment,
  validateAuthEnvironment,
} = require('../../server/config/authEnvironment');

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg.startsWith('--')) {
    const [rawKey, inlineValue] = arg.slice(2).split('=');
    const value = inlineValue ?? process.argv[index + 1];
    args.set(rawKey, value === undefined || value.startsWith?.('--') ? 'true' : value);
    if (inlineValue === undefined && value !== undefined && !String(value).startsWith('--')) index += 1;
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const noEnvFile = args.get('no-env-file') === 'true';
const envFile = noEnvFile ? '' : path.resolve(repoRoot, args.get('env-file') || 'config/auth.example.env');
const environment = args.get('environment') || process.env.NODE_ENV || 'development';
const live = args.get('live') === 'true';
const strict = args.get('strict') === 'true' || String(environment).toLowerCase() === 'production';
const requiredProvider = args.has('require-provider') ? normalizeProvider(args.get('require-provider')) : '';
const skipIfMissing = args.get('skip-if-missing') === 'true';

const safeString = (value) => String(value === undefined || value === null ? '' : value).trim();

const parseEnvFile = (filePath) => {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator === -1) return [line, ''];
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')];
    }));
};

const env = {
  ...process.env,
  ...parseEnvFile(envFile),
  NODE_ENV: environment,
};

const missingRequiredKeycloakSmokeEnv = (candidateEnv) => {
  const missing = [];
  if (normalizeProvider(candidateEnv.AUTH_PROVIDER) !== 'keycloak') {
    missing.push('AUTH_PROVIDER=keycloak');
  }

  for (const key of KEYCLOAK_REQUIRED_ENV) {
    if (!safeString(candidateEnv[key])) missing.push(key);
  }

  const clientType = safeString(candidateEnv.AUTH_CLIENT_TYPE || 'confidential').toLowerCase();
  if (clientType === 'confidential' && !safeString(candidateEnv.AUTH_CLIENT_SECRET)) {
    missing.push('AUTH_CLIENT_SECRET');
  }
  if (clientType !== 'confidential' && !safeString(candidateEnv.AUTH_OIDC_STATE_SECRET || candidateEnv.AUTH_VAULT_SECRET)) {
    missing.push('AUTH_OIDC_STATE_SECRET or AUTH_VAULT_SECRET');
  }

  return missing;
};

if (skipIfMissing && requiredProvider === 'keycloak') {
  const missing = missingRequiredKeycloakSmokeEnv(env);
  if (missing.length > 0) {
    console.log(`[auth-smoke] skip reason=missing Keycloak smoke env: ${missing.join(', ')}`);
    process.exit(0);
  }
}

const validation = validateAuthEnvironment({
  env,
  runtimeEnv: environment,
  allowPlaceholders: !strict,
});

if (!validation.safe) {
  validation.failures.forEach((failure) => console.error(`[auth-smoke] error: ${failure}`));
  process.exit(1);
}

const config = resolveAuthEnvironment(env);

if (requiredProvider && config.provider !== requiredProvider) {
  console.error(`[auth-smoke] error: AUTH_PROVIDER must be ${requiredProvider} for this smoke gate; got ${config.provider}`);
  process.exit(1);
}

if (config.provider === 'legacy') {
  console.log('[auth-smoke] ok provider=legacy mode=compatibility');
  process.exit(0);
}

console.log(`[auth-smoke] provider=${config.provider} issuer=${config.issuerUrl} jwks=${config.jwksUrl}`);

if (!live) {
  console.log('[auth-smoke] ok mode=contract-only; pass --live to check discovery and JWKS endpoints');
  process.exit(0);
}

const assertJsonEndpoint = async (url, label) => {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${label} did not return a JSON object`);
  }
  return payload;
};

try {
  const discovery = await assertJsonEndpoint(config.discoveryUrl, 'OIDC discovery');
  if (discovery.issuer !== config.issuerUrl) {
    throw new Error('OIDC discovery issuer does not match AUTH_ISSUER_URL');
  }
  const jwks = await assertJsonEndpoint(config.jwksUrl, 'OIDC JWKS');
  if (!Array.isArray(jwks.keys)) {
    throw new Error('OIDC JWKS payload has no keys array');
  }
  console.log(`[auth-smoke] ok mode=live signingKeys=${jwks.keys.length}`);
} catch (error) {
  console.error(`[auth-smoke] error: ${error.message}`);
  process.exitCode = 1;
}
