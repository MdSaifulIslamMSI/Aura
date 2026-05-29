import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { resolveAuthEnvironment, validateAuthEnvironment } = require('../../server/config/authEnvironment');

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
const envFile = path.resolve(repoRoot, args.get('env-file') || 'config/auth.example.env');
const environment = args.get('environment') || process.env.NODE_ENV || 'development';
const live = args.get('live') === 'true';

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

const validation = validateAuthEnvironment({
  env,
  runtimeEnv: environment,
  allowPlaceholders: String(environment).toLowerCase() !== 'production',
});

if (!validation.safe) {
  validation.failures.forEach((failure) => console.error(`[auth-smoke] error: ${failure}`));
  process.exit(1);
}

const config = resolveAuthEnvironment(env);

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
