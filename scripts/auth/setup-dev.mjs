import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const composeFile = path.join(repoRoot, 'infra/auth/docker-compose.yml');
const exampleEnv = path.join(repoRoot, 'config/auth.example.env');
const realmFile = path.join(repoRoot, 'infra/auth/keycloak/realm-aura-dev.json');

const requiredFiles = [composeFile, exampleEnv, realmFile];
const missing = requiredFiles.filter((file) => !existsSync(file));

if (missing.length) {
  missing.forEach((file) => console.error(`[auth-setup] missing ${path.relative(repoRoot, file)}`));
  process.exit(1);
}

console.log('[auth-setup] Local Keycloak assets are present.');
console.log('[auth-setup] Create an untracked env file from config/auth.example.env, replace KEYCLOAK_* placeholders, then run:');
console.log('docker compose -f infra/auth/docker-compose.yml --env-file <your-untracked-auth-env> up -d');
console.log('[auth-setup] After Keycloak is healthy, validate with: npm run auth:smoke -- --env-file <your-untracked-auth-env> --live');
