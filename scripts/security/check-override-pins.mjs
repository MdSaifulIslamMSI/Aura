#!/usr/bin/env node
/**
 * Fails when an EXACT-pinned `overrides` entry would revert a security fix.
 *
 * npm `overrides` force the pinned version across the whole dependency tree.
 * A range pin (`^1.2.3`) still allows a patched 1.x/2.x to be installed, but
 * an exact pin does not: when a CVE lands in a newer release, a Dependabot
 * bump is silently reverted by npm on the next install, and `npm audit fix`
 * is a no-op for that package. The release-cooldown gate does not catch
 * this - it only ages NEW versions; it says nothing about a pin that refuses
 * them.
 *
 * This gate closes that hole: for every exact-pinned override, it asks OSV
 * whether the pinned version is advisory-bearing and whether a newer,
 * unaffected version exists. If both are true, the pin is actively holding a
 * vulnerability in place and the build fails.
 *
 * A pin that is advisory-bearing with NO fixed version available is reported
 * but does not fail - there is nothing to upgrade to, and the real remedy is
 * a documented exception, not a version bump.
 *
 * Exit code 0 = pass, 1 = fail.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MANIFESTS, isExactPin, compareVersions, collectExactPins } = require('./override-pin-logic.cjs');

const repoRoot = process.cwd();

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const REGISTRY_URL = 'https://registry.npmjs.org';

const queryOsv = async (pins) => {
  const response = await fetch(OSV_BATCH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      queries: pins.map((pin) => ({
        package: { name: pin.name, ecosystem: 'npm' },
        version: pin.version,
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(`OSV query failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.results || [];
};

const fetchLatestVersion = async (name) => {
  const scoped = name.startsWith('@') ? name.replace('/', '%2f') : name;
  const response = await fetch(`${REGISTRY_URL}/${scoped}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body?.['dist-tags']?.latest || null;
};

const run = async () => {
  const pins = collectExactPins(repoRoot, MANIFESTS);
  if (pins.length === 0) {
    console.log('[security:override-pins] No exact-pinned overrides found.');
    return;
  }
  const results = await queryOsv(pins);
  const failures = [];
  const notes = [];

  for (let index = 0; index < pins.length; index += 1) {
    const pin = pins[index];
    const advisories = results[index]?.vulns || [];
    if (advisories.length === 0) continue;

    const latest = await fetchLatestVersion(pin.name);
    const advisoryIds = advisories.map((advisory) => advisory.id).filter(Boolean);
    if (!latest || compareVersions(pin.version, latest) >= 0) {
      notes.push(
        `${pin.manifest}: ${pin.name}@${pin.version} is advisory-bearing (${advisoryIds.join(', ')}) `
        + 'but no newer release exists - record an explicit exception instead of a version bump.'
      );
      continue;
    }
    failures.push(
      `${pin.manifest}: ${pin.name} is pinned to ${pin.version} and that pin is advisory-bearing `
      + `(${advisoryIds.join(', ')}), while ${latest} is available. An exact override silently reverts the `
      + 'security bump - convert the pin to a range that admits the fixed release, or record a dated exception.'
    );
  }

  for (const note of notes) console.log(`[security:override-pins] NOTE ${note}`);
  if (failures.length > 0) {
    console.error(`[security:override-pins] ${failures.length} pinned override(s) would revert a security fix:`);
    for (const failure of failures) console.error(`- ${failure}`);
    // Set the exit code rather than calling process.exit: an abrupt exit can
    // tear down the global fetch dispatcher mid-flight, which surfaces as a
    // libuv assertion instead of a clean gate failure.
    process.exitCode = 1;
    return;
  }
  console.log(
    `[security:override-pins] PASS - ${pins.length} exact-pinned override(s) checked; none is holding an advisory-bearing version in place.`
  );
};

// Only run the check when invoked directly, so the pure helpers above can be
// imported by the regression suite without triggering a network call.
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  run().catch((error) => {
    console.error(`[security:override-pins] Could not complete the check: ${error.message}`);
    process.exitCode = 1;
  });
}