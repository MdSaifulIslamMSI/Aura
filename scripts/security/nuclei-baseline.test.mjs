import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  countNucleiGatingFindings,
  filterNucleiJsonlReport,
  filterNucleiSarifReport,
  isAcceptedNucleiFinding,
  loadNucleiExceptions,
} from './nuclei-baseline.mjs';

const isoInDays = (days) => {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
};

const writeJsonl = (dir, findings) => {
  const reportPath = path.join(dir, 'nuclei-report.jsonl');
  writeFileSync(reportPath, `${findings.map((finding) => JSON.stringify(finding)).join('\n')}\n`);
  return reportPath;
};

const readJsonl = (reportPath) => readFileSync(reportPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const writeSarif = (dir, ruleIds) => {
  const reportPath = path.join(dir, 'nuclei-report.sarif');
  writeFileSync(reportPath, `${JSON.stringify({
    version: '4.25.0',
    runs: [{
      tool: { driver: { name: 'nuclei' } },
      results: ruleIds.map((ruleId) => ({
        ruleId,
        message: { text: `finding for ${ruleId} at http://127.0.0.1:4173/app` },
      })),
    }],
  }, null, 2)}\n`);
  return reportPath;
};

const readSarifRuleIds = (reportPath) => JSON.parse(readFileSync(reportPath, 'utf8'))
  .runs[0].results.map((result) => result.ruleId);

const exception = (overrides = {}) => ({
  template: 'http-missing-security-headers',
  reason: 'edge policy enforced upstream',
  expiresOn: isoInDays(90),
  ...overrides,
});

test('valid exceptions entry suppresses the matching template finding', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aura-nuclei-baseline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const reportPath = writeJsonl(dir, [
    { templateID: 'http-missing-security-headers', matchedAt: 'http://127.0.0.1:4173/', info: { name: 'http-missing-security-headers', severity: 'info' } },
    { templateID: 'cves-2024-1234', matchedAt: 'http://127.0.0.1:4173/api', info: { name: 'CVE-2024-1234', severity: 'critical' } },
  ]);

  const removed = filterNucleiJsonlReport(reportPath, [exception()]);

  assert.equal(removed, 1);
  assert.deepEqual(readJsonl(reportPath).map((finding) => finding.templateID), ['cves-2024-1234']);
});

test('expired exceptions stop suppressing and resurface the finding', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aura-nuclei-baseline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const reportPath = writeJsonl(dir, [
    { templateID: 'http-missing-security-headers', matchedAt: 'http://127.0.0.1:4173/', info: { name: 'http-missing-security-headers', severity: 'info' } },
  ]);
  const stale = exception({ expiresOn: isoInDays(-1) });

  assert.equal(filterNucleiJsonlReport(reportPath, [stale]), 0);
  assert.equal(readJsonl(reportPath).length, 1);
  assert.equal(isAcceptedNucleiFinding({ templateID: 'http-missing-security-headers' }, [stale]), false);
});

test('host-scoped exceptions only suppress that host', (t) => {
  const scoped = exception({ host: 'staging.aura-marketplace.example' });
  const stagingFinding = { templateID: 'http-missing-security-headers', matchedAt: 'https://staging.aura-marketplace.example/' };
  const previewFinding = { templateID: 'http-missing-security-headers', matchedAt: 'https://preview-ref.vercel.example/' };

  assert.equal(isAcceptedNucleiFinding(stagingFinding, [scoped]), true);
  assert.equal(isAcceptedNucleiFinding(previewFinding, [scoped]), false);
});

test('exceptions without a template or without a reason never suppress', () => {
  const finding = { templateID: 'http-missing-security-headers' };
  assert.equal(isAcceptedNucleiFinding(finding, [{ reason: 'no template', expiresOn: isoInDays(30) }]), false);
  assert.equal(isAcceptedNucleiFinding(finding, [{ template: 'http-missing-security-headers' }]), false);
});

test('gating count only counts high and critical severities', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aura-nuclei-baseline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const reportPath = writeJsonl(dir, [
    { templateID: 'a', info: { severity: 'critical' } },
    { templateID: 'b', info: { severity: 'HIGH' } },
    { templateID: 'c', info: { severity: 'medium' } },
    { templateID: 'd', info: { severity: 'info' } },
  ]);

  assert.equal(countNucleiGatingFindings(reportPath).length, 2);
});

test('SARIF report drops suppressed rules and keeps live ones', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aura-nuclei-baseline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const sarifPath = writeSarif(dir, ['http-missing-security-headers', 'cves-2024-1234']);

  const removed = filterNucleiSarifReport(sarifPath, [exception()]);

  assert.equal(removed, 1);
  assert.deepEqual(readSarifRuleIds(sarifPath), ['cves-2024-1234']);
});

test('missing reports and malformed exception files are handled', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aura-nuclei-baseline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(filterNucleiJsonlReport(path.join(dir, 'missing.jsonl'), []), 0);
  assert.equal(filterNucleiSarifReport(path.join(dir, 'missing.sarif'), []), 0);
  assert.deepEqual(loadNucleiExceptions(path.join(dir, 'missing.json')), []);
  const emptyPath = path.join(dir, 'exceptions.json');
  writeFileSync(emptyPath, '{"exceptions": []}');
  assert.deepEqual(loadNucleiExceptions(emptyPath), []);

  const brokenPath = path.join(dir, 'broken.json');
  writeFileSync(brokenPath, '{ not json');
  assert.throws(() => loadNucleiExceptions(brokenPath), /not valid JSON/);
});
