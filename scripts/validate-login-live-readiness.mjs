import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const strict = process.argv.includes('--strict');

const requiredAssets = [
  'infra/aws/waf-login-security-cloudfront.yml',
  'infra/observability/docker-compose.ec2.yml',
  'docs/login-staging-production-activation.md',
  'server/config/loginRuntimeEnforcementPolicy.js',
  'app/src/config/firebase.js',
];

const missingAssets = requiredAssets.filter((relativePath) => !existsSync(join(repoRoot, relativePath)));
if (missingAssets.length > 0) {
  throw new Error(`Missing login activation asset(s): ${missingAssets.join(', ')}`);
}

const env = (name) => String(process.env[name] || '').trim();
const isTrue = (name) => ['1', 'true', 'yes', 'on'].includes(env(name).toLowerCase());

const blockers = [];
const warnings = [];

const environmentName = env('AURA_LOGIN_ENVIRONMENT');
if (!['staging', 'production'].includes(environmentName)) {
  blockers.push('Set AURA_LOGIN_ENVIRONMENT to staging or production before a live activation.');
}

if (!env('AURA_CLOUDFRONT_DISTRIBUTION_ID')) {
  blockers.push('Set AURA_CLOUDFRONT_DISTRIBUTION_ID to the target CloudFront distribution id.');
}

if (!env('AURA_WAF_STACK_NAME')) {
  blockers.push('Set AURA_WAF_STACK_NAME to the staging/prod WAF CloudFormation stack name.');
}

if (!env('METRICS_SECRET')) {
  blockers.push('Set METRICS_SECRET before starting the EC2 observability overlay.');
}

if (!env('GRAFANA_ADMIN_PASSWORD')) {
  blockers.push('Set GRAFANA_ADMIN_PASSWORD before starting Grafana outside local dev.');
}

if (!isTrue('VITE_FIREBASE_ENABLE_MICROSOFT_AUTH')) {
  warnings.push('Microsoft login stays hidden until VITE_FIREBASE_ENABLE_MICROSOFT_AUTH=true and Firebase console setup is complete.');
}

if (!isTrue('VITE_FIREBASE_ENABLE_APPLE_AUTH')) {
  warnings.push('Apple login stays hidden until VITE_FIREBASE_ENABLE_APPLE_AUTH=true and Firebase console setup is complete.');
}

const riskEngineMode = env('AUTH_RISK_ENGINE_MODE') || 'monitor';
if (!['off', 'monitor', 'enforce'].includes(riskEngineMode)) {
  blockers.push('AUTH_RISK_ENGINE_MODE must be one of: off, monitor, enforce.');
}

if (riskEngineMode === 'enforce' && !isTrue('AUTH_SECURITY_OUTBOX_ENABLED')) {
  blockers.push('Do not set AUTH_RISK_ENGINE_MODE=enforce until AUTH_SECURITY_OUTBOX_ENABLED=true is active and observed in staging.');
}

if (riskEngineMode === 'enforce' && !env('AUTH_RISK_SIGNAL_SECRET')) {
  blockers.push('Set AUTH_RISK_SIGNAL_SECRET before AUTH_RISK_ENGINE_MODE=enforce so edge/server login risk signals are signed.');
}

if (isTrue('PRIVILEGED_JIT_ACCESS_ENABLED')) {
  warnings.push('Privileged JIT is enabled; confirm the approval workflow and audit review are staffed before production.');
}

const status = blockers.length === 0 ? 'ready' : 'blocked';

console.log(`Login live readiness: ${status}`);
console.log('Repo activation assets: present');

if (blockers.length > 0) {
  console.log('\nBlockers:');
  for (const blocker of blockers) {
    console.log(`- ${blocker}`);
  }
}

if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

console.log('\nUse --strict to fail the command while live blockers remain.');

if (strict && blockers.length > 0) {
  process.exitCode = 1;
}
