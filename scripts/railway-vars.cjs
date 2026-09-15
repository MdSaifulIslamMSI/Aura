// Push/restore the Railway VITE_* build contract for the storefront service.
//
//   node scripts/railway-vars.cjs push     # snapshot prior values, then write
//   node scripts/railway-vars.cjs restore  # replay the snapshot
//
// Used by scripts/deploy-railway.sh and scripts/rollback-railway.sh. Both
// lanes push the identical key set from scripts/railway-release-env.cjs so a
// rollback rebuild is byte-comparable with a normal release build.
//
// Empty strings are preserved by piping the value through --stdin (the
// `KEY=` assignment form can drop them). `--skip-deploys` keeps the var write
// from kicking off its own Railway deployment.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const { buildRailwayBuildEnv } = require('./railway-release-env.cjs');

const serviceId = process.env.RAILWAY_SERVICE_ID;
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
const stateFile = process.env.RAILWAY_STATE_FILE;
const mode = process.argv[2];

if (!serviceId || !environmentId) {
  console.error('RAILWAY_SERVICE_ID and RAILWAY_ENVIRONMENT_ID are required.');
  process.exit(1);
}
if (!stateFile) {
  console.error('RAILWAY_STATE_FILE is required.');
  process.exit(1);
}
if (mode !== 'push' && mode !== 'restore') {
  console.error('usage: railway-vars.cjs <push|restore>');
  process.exit(1);
}

const railway = (args, input) => execFileSync('railway', args, {
  input,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
});

const readPriorValues = () => {
  const out = railway([
    'variable', 'list',
    '--service', serviceId,
    '--environment', environmentId,
    '--kv',
  ]);
  return Object.fromEntries(
    out.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=');
        return separator === -1
          ? [line, null]
          : [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
};

const writeValue = (key, value) => railway([
  'variable', 'set', key,
  '--service', serviceId,
  '--environment', environmentId,
  '--skip-deploys',
  '--stdin',
], `${value}`);

const deleteValue = (key) => railway([
  'variable', 'delete', key,
  '--service', serviceId,
  '--environment', environmentId,
]);

if (mode === 'push') {
  const contract = buildRailwayBuildEnv();
  const prior = readPriorValues();
  const snapshot = {};
  for (const key of Object.keys(contract)) {
    snapshot[key] = Object.prototype.hasOwnProperty.call(prior, key) ? prior[key] : null;
  }
  fs.writeFileSync(stateFile, JSON.stringify(snapshot));
  for (const [key, value] of Object.entries(contract)) {
    writeValue(key, value);
  }
  console.log(`Pushed ${Object.keys(contract).length} VITE_* vars onto Railway service ${serviceId} (prior values snapshotted).`);
} else {
  const snapshot = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const keys = Object.keys(snapshot);
  for (const key of keys) {
    if (snapshot[key] === null) {
      deleteValue(key);
    } else {
      writeValue(key, snapshot[key]);
    }
  }
  console.log(`Restored ${keys.length} Railway variables.`);
}