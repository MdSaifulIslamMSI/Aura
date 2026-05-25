#!/usr/bin/env node
import process from 'node:process';
import {
  getTargetEnv,
  printContractReport,
  validateContract,
} from './env-contract-lib.mjs';

const args = new Map(process.argv.slice(2)
  .filter((arg) => arg.startsWith('--'))
  .map((arg) => {
    const [key, ...value] = arg.slice(2).split('=');
    return [key, value.length > 0 ? value.join('=') : 'true'];
  }));

const env = { ...process.env };
if (args.has('target') && !env.SMOKE_TARGET_ENV) {
  env.SMOKE_TARGET_ENV = args.get('target');
}

if (!env.SMOKE_TARGET_ENV && !env.CONTRACT_TARGET_ENV && !env.VERCEL_ENV && !env.APP_ENV) {
  console.error('SMOKE_TARGET_ENV is required for smoke preflight. Use SMOKE_TARGET_ENV=local, staging, or production.');
  process.exit(1);
}

const targetEnv = getTargetEnv(env, '');
const result = validateContract({ env, mode: 'smoke-preflight' });

printContractReport(result);
process.stdout.write(`safety classification: ${result.safe ? `${targetEnv}-preflight-safe` : `${targetEnv}-preflight-blocked`}\n`);

if (!result.safe) {
  process.stdout.write('No live request was made.\n');
  process.exitCode = 1;
}
