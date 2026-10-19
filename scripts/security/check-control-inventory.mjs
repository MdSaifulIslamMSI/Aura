#!/usr/bin/env node
/**
 * Verifies the security control inventory against the shipped production
 * environment template and against the code defaults it claims.
 *
 * The 2026-10-12 posture assessment fixed one dark-control layer and left the
 * next three dark, with nothing tracking them: the production contract only
 * ever covered the layer that had just been fixed. That is a governance
 * pattern, not a bug, and it needs a machine-checked counterweight.
 *
 * This gate makes it impossible to add a control that is dark in production
 * without saying so:
 *   - every control is either ENFORCED or STAGED, never unclassified;
 *   - an ENFORCED control must be present with its required value in the
 *     production environment template;
 *   - a STAGED control must carry a written reason and an expiry, and the
 *     gate FAILS once that expiry passes;
 *   - a control whose code default has drifted from the recorded default
 *     fails, so the inventory cannot quietly go stale.
 *
 * Exit code 0 = pass, 1 = fail.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const inventoryArg = process.argv.find((entry) => entry.startsWith('--inventory='));
const inventoryPath = inventoryArg
  ? path.resolve(repoRoot, inventoryArg.slice('--inventory='.length))
  : path.join(repoRoot, 'config', 'security', 'control-inventory.json');
const productionEnvPath = path.join(repoRoot, 'config', 'environments', 'production.example.env');

const failures = [];

const readProductionEnv = () => {
  if (!fs.existsSync(productionEnvPath)) return null;
  const values = new Map();
  for (const line of fs.readFileSync(productionEnvPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!values.has(key)) values.set(key, value);
  }
  return values;
};

const resolveProbeValue = (resolved, probePath) => {
  if (!probePath) return resolved;
  return String(probePath)
    .split('.')
    .reduce((current, segment) => (current == null ? undefined : current[segment]), resolved);
};

const checkCodeDefault = (control) => {
  const probe = control.codeDefaultProbe;
  if (!probe) return;
  const modulePath = path.join(repoRoot, probe.module);
  if (!fs.existsSync(modulePath)) {
    failures.push(`${control.id}: codeDefaultProbe module not found: ${probe.module}`);
    return;
  }
  let resolver;
  try {
    resolver = require(modulePath);
  } catch (error) {
    failures.push(`${control.id}: codeDefaultProbe could not load ${probe.module}: ${error.message}`);
    return;
  }
  const fn = resolver[probe.export];
  if (typeof fn !== 'function') {
    failures.push(`${control.id}: codeDefaultProbe export not found: ${probe.export}`);
    return;
  }
  let resolved;
  try {
    // A probe may pin the environment it resolves against: several controls
    // default to `production ? on : off`, so resolving against an empty env
    // would report the wrong default.
    resolved = fn(probe.env || {});
  } catch (error) {
    failures.push(`${control.id}: codeDefaultProbe threw: ${error.message}`);
    return;
  }
  const actual = resolveProbeValue(resolved, probe.path);
  if (actual !== probe.expected) {
    failures.push(
      `${control.id}: code default drift - ${probe.module}#${probe.export}().${probe.path || ''} is ${JSON.stringify(actual)}, inventory records ${JSON.stringify(probe.expected)}`
    );
  }
};

const run = () => {
  if (!fs.existsSync(inventoryPath)) {
    console.error(`[security:controls] Control inventory not found: ${inventoryPath}`);
    process.exit(1);
  }

  let inventory;
  try {
    inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  } catch (error) {
    console.error(`[security:controls] Control inventory is not valid JSON: ${error.message}`);
    process.exit(1);
  }

  const controls = Array.isArray(inventory.controls) ? inventory.controls : [];
  if (controls.length === 0) {
    console.error('[security:controls] Control inventory contains no controls');
    process.exit(1);
  }

  const productionEnv = readProductionEnv();
  if (!productionEnv) {
    console.error(`[security:controls] Production environment template not found: ${productionEnvPath}`);
    process.exit(1);
  }

  const now = Date.now();
  const seenIds = new Set();
  const seenEnvVars = new Set();

  for (const control of controls) {
    const id = control?.id || '(missing id)';
    if (!control?.id) failures.push('A control is missing its id');
    if (!control?.title) failures.push(`${id}: missing title`);
    if (!control?.envVar) failures.push(`${id}: missing envVar`);
    if (typeof control?.enforcedInProduction !== 'boolean') {
      failures.push(`${id}: enforcedInProduction must be a boolean`);
    }
    if (seenIds.has(control?.id)) failures.push(`${id}: duplicate control id`);
    seenIds.add(control?.id);
    if (seenEnvVars.has(control?.envVar)) failures.push(`${id}: duplicate envVar ${control?.envVar}`);
    seenEnvVars.add(control?.envVar);

    const enforced = control?.enforcedInProduction === true;
    const staged = control?.staged ?? null;

    if (enforced) {
      if (staged) {
        failures.push(`${id}: a control cannot be enforced and staged at the same time`);
      }
      if (typeof control?.requiredValue !== 'string' || control.requiredValue.length === 0) {
        failures.push(`${id}: an enforced control must declare a requiredValue`);
      } else {
        const actual = productionEnv.get(control.envVar);
        if (actual === undefined) {
          failures.push(`${id}: ${control.envVar} is enforced but is missing from ${path.relative(repoRoot, productionEnvPath)}`);
        } else if (actual !== control.requiredValue) {
          failures.push(
            `${id}: ${control.envVar} is enforced but the production template sets it to ${JSON.stringify(actual)} (expected ${JSON.stringify(control.requiredValue)})`
          );
        }
      }
    } else {
      if (!staged) {
        failures.push(`${id}: a control that is not enforced in production must be staged with a reason and an expiry`);
      } else {
        if (!staged.reason || String(staged.reason).trim().length === 0) {
          failures.push(`${id}: a staged control must carry a reason`);
        }
        const expires = Date.parse(staged.expires || '');
        if (!Number.isFinite(expires)) {
          failures.push(`${id}: a staged control must carry a parseable expires date`);
        } else if (expires <= now) {
          failures.push(
            `${id}: staging expired on ${staged.expires}. Either enforce ${control.envVar} in production or re-justify the staging with a new expiry.`
          );
        }
        const templateValue = productionEnv.get(control.envVar);
        if (templateValue !== undefined && control.requiredValue && templateValue === control.requiredValue) {
          failures.push(
            `${id}: ${control.envVar} is staged but the production template enables it. Move the control to enforcedInProduction so the inventory reflects the deployment.`
          );
        }
      }
    }

    checkCodeDefault(control);
  }

  if (failures.length > 0) {
    console.error(`[security:controls] ${failures.length} control-inventory problem(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  const enforcedCount = controls.filter((control) => control.enforcedInProduction === true).length;
  const stagedCount = controls.length - enforcedCount;
  console.log(
    `[security:controls] PASS - ${controls.length} control(s) classified: ${enforcedCount} enforced, ${stagedCount} staged (each staged control has a dated justification).`
  );
};

run();
