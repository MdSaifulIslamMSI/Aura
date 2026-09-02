#!/usr/bin/env node
'use strict';

/**
 * Regression gate for the Actions audit (blocking).
 *
 * Fails when any finding from an ENFORCED audit class appears. These classes
 * were eliminated in the 2026-08 hardening batch and must never return:
 *   - artipacked        (checkout persisting credentials)
 *   - unpinned-uses     (actions pinned by tag instead of commit SHA)
 *
 * The remaining audit classes (template-injection, excessive-permissions,
 * dangerous-triggers, superfluous-actions) require per-site review and are
 * tracked in docs/security-actions-audit-policy.md — they are reported in
 * SARIF but do not block this gate.
 *
 * Usage: node scripts/security/actions-audit-regression-gate.mjs <zizmor-json-file>
 */

import fs from 'node:fs';

const ENFORCED_AUDITS = new Set(['artipacked', 'unpinned-uses']);

const file = process.argv[2];
if (!file) {
    console.error('usage: node scripts/security/actions-audit-regression-gate.mjs <zizmor-json>');
    process.exit(2);
}

const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const findings = JSON.parse(raw.slice(raw.indexOf('[')));

const violations = findings.filter((f) => ENFORCED_AUDITS.has(f.ident));

if (violations.length === 0) {
    console.log(`[actions-audit-gate] PASS — ${findings.length} reported findings, 0 in enforced classes.`);
    process.exit(0);
}

console.error(`[actions-audit-gate] FAIL — ${violations.length} finding(s) in enforced classes:`);
for (const v of violations) {
    const location = v.locations?.[0]?.symbolic?.key?.Local?.verbatim_path || 'unknown';
    const row = v.locations?.[0]?.concrete?.location?.start_point?.row ?? '?';
    console.error(`  ${v.ident} @ ${location}:${row} — ${v.desc}`);
}
process.exit(1);
