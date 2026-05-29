import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { validateAuthEnvironment } = require('../../server/config/authEnvironment');

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
const strict = args.get('strict') === 'true' || String(environment).toLowerCase() === 'production';

const parseEnvFile = (filePath) => {
  if (!existsSync(filePath)) {
    throw new Error(`Auth env file not found: ${filePath}`);
  }
  return Object.fromEntries(readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator === -1) return [line, ''];
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
      return [key, value];
    }));
};

const fileEnv = parseEnvFile(envFile);
const env = {
  ...process.env,
  ...fileEnv,
  NODE_ENV: environment,
};

const result = validateAuthEnvironment({
  env,
  runtimeEnv: environment,
  allowPlaceholders: !strict,
});

for (const warning of result.warnings) {
  console.warn(`[auth-env] warning: ${warning}`);
}

if (!result.safe) {
  for (const failure of result.failures) {
    console.error(`[auth-env] error: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`[auth-env] ok provider=${result.provider} env=${environment} file=${path.relative(repoRoot, envFile)}`);
}
