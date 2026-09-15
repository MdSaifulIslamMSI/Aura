// Push the Railway VITE_* build contract for the storefront service.
//
//   node scripts/railway-vars.cjs push
//
// Used by scripts/deploy-railway.sh and the commit-rebuild fallback in
// scripts/rollback-railway.sh, so a rollback rebuild is byte-comparable with
// a normal release build.
//
// Parity variables are left standing on the service after the deploy: the
// next release overwrites them, and deleting them afterwards would trigger
// variable-delete redeploys of the live site without release metadata
// (Railway redeploys on variable changes; only writes honour
// --skip-deploys).
//
// Empty strings are preserved by piping the value through --stdin (the
// `KEY=` assignment form can drop them). `--skip-deploys` keeps the var write
// from kicking off its own Railway deployment.
'use strict';

const { execFileSync } = require('node:child_process');

const { buildRailwayBuildEnv } = require('./railway-release-env.cjs');

const serviceId = process.env.RAILWAY_SERVICE_ID;
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
const mode = process.argv[2];

if (!serviceId || !environmentId) {
  console.error('RAILWAY_SERVICE_ID and RAILWAY_ENVIRONMENT_ID are required.');
  process.exit(1);
}
if (mode !== 'push') {
  console.error('usage: railway-vars.cjs push');
  process.exit(1);
}

const railway = (args, input) => execFileSync('railway', args, {
  input,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
});

const writeValue = (key, value) => railway([
  'variable', 'set', key,
  '--service', serviceId,
  '--environment', environmentId,
  '--skip-deploys',
  '--stdin',
], `${value}`);

const contract = buildRailwayBuildEnv();
for (const [key, value] of Object.entries(contract)) {
  writeValue(key, value);
}
console.log(`Pushed ${Object.keys(contract).length} VITE_* vars onto Railway service ${serviceId}.`);
