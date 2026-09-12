#!/usr/bin/env node
'use strict';

/**
 * 1Password secret-contract audit (offline, never prints secret values).
 * Checks: provider module shape, env contract documentation, no value logging,
 * bootstrapper wiring in start_api/worker_runtime, frontend autocomplete guard.
 * Exit non-zero on any violation. Prints names and counts only.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const serverRoot = path.resolve(__dirname, '..');
const failures = [];
const notes = [];

const check = (name, ok, detail = '') => {
    if (ok) notes.push(`ok: ${name}`);
    else failures.push(`fail: ${name}${detail ? ` (${detail})` : ''}`);
};

const readFile = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

// 1. Provider module shape (require it — no network on import).
let provider = null;
try {
    provider = require('../config/onePasswordProvider');
    check('provider loads', true);
} catch (error) {
    check('provider loads', false, String(error.message).slice(0, 100));
}
if (provider) {
    for (const fn of ['isOnePasswordReference', 'parseOnePasswordReference', 'resolveOnePasswordConfig', 'primeOnePasswordEnv']) {
        check(`provider exports ${fn}`, typeof provider[fn] === 'function');
    }
    // spot-check parsing without secrets
    try {
        const parsed = provider.parseOnePasswordReference('op://vault/item/field');
        check('provider parses op://', parsed.vault === 'vault' && parsed.field === 'field');
    } catch {
        check('provider parses op://', false);
    }
    let threw = false;
    try {
        provider.parseOnePasswordReference('op://bad');
    } catch {
        threw = true;
    }
    check('provider rejects malformed refs', threw);
}

// 2. runtimeConfig wiring.
const runtimeConfigSrc = readFile(path.join(serverRoot, 'config', 'runtimeConfig.js'));
check('runtimeConfig exposes primeRuntimeSecretsEnv', runtimeConfigSrc.includes('primeRuntimeSecretsEnv'));
check('runtimeConfig keeps primeAwsParameterStoreEnv (compat)', runtimeConfigSrc.includes('primeAwsParameterStoreEnv'));
for (const script of ['start_api_runtime.js', 'start_worker_runtime.js']) {
    const src = readFile(path.join(serverRoot, 'scripts', script));
    check(`${script} uses unified bootstrapper`, src.includes('primeRuntimeSecretsEnv'));
}

// 3. No secret-value logging in the provider (static guard).
const providerSrc = readFile(path.join(serverRoot, 'config', 'onePasswordProvider.js'));
const forbidsLoggingValue = !/console\.log\([^)]*(value|token|secret)[^)]*\)/i.test(providerSrc)
    && !/logger\.(info|warn|error)\([^)]*\b(value|secret|token)\s*:/i.test(providerSrc.replace(/key: envName/g, ''));
check('provider never logs secret values/token', forbidsLoggingValue);
check('provider fail-closes (onepassword_resolve_failed)', providerSrc.includes('onepassword_resolve_failed'));
check('provider supports vault allowlist', providerSrc.includes('OP_CONNECT_VAULT_ALLOWLIST'));

// 4. Env contract documented (names only).
const envExample = readFile(path.join(serverRoot, '.env.example'));
for (const name of ['ONEPASSWORD_ENABLED', 'ONEPASSWORD_REQUIRED', 'OP_CONNECT_HOST', 'OP_CONNECT_TOKEN', 'OP_CONNECT_VAULT_ALLOWLIST', 'OP_CONNECT_ITEM_MAP', 'RUNTIME_SECRETS_PROVIDER']) {
    check(`.env.example documents ${name}`, envExample.includes(name));
}

// 5. Frontend 1Password-fillability guard (static: no autocomplete=off on credential inputs).
const loginView = readFile(path.join(repoRoot, 'app', 'src', 'pages', 'Login', 'LoginView.jsx'));
check('login form keeps autoComplete=on', loginView.includes('autoComplete="on"'));
check('signin email uses username', loginView.includes("autoComplete={mode === 'signin' ? 'username' : 'email'}"));
check('signin password uses current-password', loginView.includes("autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}"));
check('otp first cell uses one-time-code', loginView.includes("autoComplete={index === 0 ? 'one-time-code' : 'off'}"));
const credentialOff = /id="login-(email|password|new-password|confirm-password)"[^>]*autoComplete="off"/.test(loginView);
check('no autocomplete=off on credential inputs', !credentialOff);

// 6. Tests exist.
check('provider tests exist', fs.existsSync(path.join(serverRoot, 'tests', 'onePasswordProvider.test.js')));
check(
    'frontend compatibility tests exist',
    fs.existsSync(path.join(repoRoot, 'app', 'src', 'pages', 'Login', 'onePasswordCompatibility.test.jsx'))
);

for (const note of notes) console.log(note);
if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error(`1password contract audit: ${failures.length} failure(s)`);
    process.exit(1);
}
console.log('1password contract audit: PASS');
