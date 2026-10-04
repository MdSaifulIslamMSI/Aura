#!/usr/bin/env node
// aurasec-supply-chain — fail-closed npm supply-chain gates.
//
// Subcommands:
//   allow-scripts   every lifecycle-script package in the lockfile(s) must be
//                   allowlisted in its package.json `allowScripts` map
//   registry        every registry-sourced lockfile entry must resolve to the
//                   official npm registry over HTTPS with a sha512 integrity hash
//   freshness       changed lockfile versions must be at least N days old on
//                   the registry (release cooldown), unless expiringly allowlisted
//
// Exit codes: 0 = pass, 1 = gate failure, 2 = usage error.

import { checkAllowScripts } from '../lib/allow-scripts-gate.mjs';
import { checkRegistry } from '../lib/registry-gate.mjs';
import { checkFreshness, DEFAULT_MIN_AGE_DAYS, DEFAULT_REGISTRY } from '../lib/freshness-gate.mjs';

const USAGE = `Usage: aurasec-supply-chain <gate> [options]

Gates:
  allow-scripts   [--lockfile <path> --package-json <path>]...   (default: ./package-lock.json + ./package.json)
                  Every install-script package must be allowlisted in the
                  package.json "allowScripts" map; stale entries fail too.

  registry        [--lockfile <path>]... [--registry-host <host>]  (default: ./package-lock.json, registry.npmjs.org)
                  Every entry must resolve to the official registry over
                  HTTPS with a matching tarball path and sha512 integrity.

  freshness       [--lockfile <path>]... [--min-age-days <n>] [--allowlist <path>]
                  [--base <git-ref>] [--registry <url>]
                  Changed lockfile versions must be at least n days old
                  (default 7) on the registry. Base resolution: --base, then
                  $GITHUB_BASE_REF (pull_request merge-base), then
                  $GITHUB_EVENT_BEFORE (push SHA), then HEAD~1. The allowlist
                  file format is { "allowed": [{ name, version?, reason, expires }] };
                  expired or reason-less entries fail the gate (fail-closed).

Flags accept --flag=value or --flag value. Repeatable flags are collected in order.
Exit codes: 0 pass, 1 gate failure, 2 usage error.`;

const usageError = (message) => {
    console.error(`[aurasec-supply-chain] ${message}`);
    console.error(USAGE);
    process.exit(2);
};

const parseFlags = (argv) => {
    const values = new Map();
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) usageError(`unexpected argument: ${arg}`);
        const eq = arg.indexOf('=');
        let name;
        let value;
        if (eq !== -1) {
            name = arg.slice(2, eq);
            value = arg.slice(eq + 1);
        } else {
            name = arg.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) {
                values.set(name, [...(values.get(name) || []), 'true']);
                continue;
            }
            value = next;
            i += 1;
        }
        values.set(name, [...(values.get(name) || []), value]);
    }
    return {
        getAll: (name) => values.get(name) || [],
        getOne: (name) => values.get(name)?.[0],
        has: (name) => values.has(name),
        names: [...values.keys()],
    };
};

const KNOWN_FLAGS = {
    'allow-scripts': new Set(['lockfile', 'package-json', 'help']),
    registry: new Set(['lockfile', 'registry-host', 'help']),
    freshness: new Set(['lockfile', 'min-age-days', 'allowlist', 'base', 'registry', 'help']),
};

const assertKnownFlags = (gate, flags) => {
    const known = KNOWN_FLAGS[gate];
    const unknown = flags.names.filter((name) => !known.has(name));
    if (unknown.length) usageError(`unknown flag(s) for "${gate}": --${unknown.join(', --')}`);
};

const DEFAULT_LOCKFILE = 'package-lock.json';
const DEFAULT_PACKAGE_JSON = 'package.json';

const requirePairs = (flags) => {
    const lockfiles = flags.getAll('lockfile');
    const packageJsons = flags.getAll('package-json');
    const anyGiven = lockfiles.length > 0 || packageJsons.length > 0;
    const resolvedLockfiles = anyGiven ? lockfiles : [DEFAULT_LOCKFILE];
    const resolvedPackageJsons = anyGiven ? packageJsons : [DEFAULT_PACKAGE_JSON];
    if (resolvedLockfiles.length !== resolvedPackageJsons.length) {
        usageError('allow-scripts requires --lockfile and --package-json in matching pairs (one of each per workspace).');
    }
    return resolvedLockfiles.map((lockfile, index) => ({
        name: lockfile,
        lockfile,
        packageJson: resolvedPackageJsons[index],
    }));
};

const finish = (gate, { ok, logs, errors }) => {
    const prefix = `[aurasec-supply-chain:${gate}]`;
    for (const line of logs) console.log(`${prefix} ${line}`);
    if (!ok) {
        for (const line of errors) console.error(`${prefix} ${line}`);
        console.error(`${prefix} FAILED — supply-chain gate rejected the current state.`);
        process.exit(1);
    }
    console.log(`${prefix} PASS.`);
};

const hasHelp = (flags) => flags.has('help') || flags.has('h');

const main = async () => {
    const [gate, ...rest] = process.argv.slice(2);
    if (!gate || gate === 'help' || gate === '--help' || gate === '-h') {
        console.log(USAGE);
        process.exit(gate ? 0 : 2);
    }
    if (!(gate in KNOWN_FLAGS)) usageError(`unknown gate: ${gate}`);

    const flags = parseFlags(rest);
    assertKnownFlags(gate, flags);
    if (hasHelp(flags)) {
        console.log(USAGE);
        process.exit(0);
    }

    if (gate === 'allow-scripts') {
        finish(gate, checkAllowScripts({ workspaces: requirePairs(flags) }));
        return;
    }

    if (gate === 'registry') {
        finish(gate, checkRegistry({
            lockfiles: flags.has('lockfile') ? flags.getAll('lockfile') : [DEFAULT_LOCKFILE],
            registryHost: flags.getOne('registry-host') || 'registry.npmjs.org',
        }));
        return;
    }

    // freshness
    const minAgeDaysRaw = flags.getOne('min-age-days');
    const minAgeDays = minAgeDaysRaw === undefined ? DEFAULT_MIN_AGE_DAYS : Number(minAgeDaysRaw);
    if (minAgeDaysRaw !== undefined && (!Number.isFinite(minAgeDays) || minAgeDays <= 0)) {
        usageError('--min-age-days must be a positive number.');
    }
    finish(gate, await checkFreshness({
        lockfiles: flags.has('lockfile') ? flags.getAll('lockfile') : [DEFAULT_LOCKFILE],
        minAgeDays,
        allowlistPath: flags.getOne('allowlist'),
        base: flags.getOne('base'),
        registryUrl: flags.getOne('registry') || DEFAULT_REGISTRY,
    }));
};

main().catch((error) => {
    console.error(`[aurasec-supply-chain] unexpected failure: ${error?.stack || error}`);
    process.exit(1);
});
