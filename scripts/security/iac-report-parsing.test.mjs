import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkovReportEntries,
  countCheckovFailedChecks,
  filterAcceptedCheckovChecks,
  countTfsecFindings,
  countTerrascanViolations,
} from './iac-report-parsing.mjs';

// Shapes below are taken from the CI run that failed the gate (2026-10-12):
// checkov --compact emits an ARRAY of per-check-type entries, tfsec writes
// { results: [...] }, terrascan writes { results: { violations: [...] } }.

const checkovEntry = (checkId, filePath) => ({
  check_type: 'cloudformation',
  results: {
    failed_checks: [{ check_id: checkId, file_path: filePath }],
  },
});

test('counts checkov failed checks across the compact array shape', () => {
  const report = [
    checkovEntry('CKV_AWS_18', 'infra/aws/cloudformation-bootstrap.yml'),
    checkovEntry('CKV_K8S_35', 'k8s/base/deployment.yaml'),
  ];
  assert.equal(countCheckovFailedChecks(report), 2);
});

test('counts checkov failed checks on the plain object shape', () => {
  const report = {
    results: { failed_checks: [{ check_id: 'CKV_AWS_18', file_path: 'infra/x.yml' }] },
    summary: { failed: 1 },
  };
  assert.equal(countCheckovFailedChecks(report), 1);
});

test('counts zero when a report has no failed checks', () => {
  assert.equal(countCheckovFailedChecks([]), 0);
  assert.equal(countCheckovFailedChecks({ results: {} }), 0);
  assert.equal(countCheckovFailedChecks(null), 0);
});

test('normalises both checkov shapes to entries', () => {
  assert.deepEqual(checkovReportEntries([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(checkovReportEntries({ b: 2 }), [{ b: 2 }]);
});

test('filters accepted checkov findings across every array entry', () => {
  const report = [
    checkovEntry('CKV_AWS_18', 'infra/aws/cloudformation-bootstrap.yml'), // accepted
    checkovEntry('CKV_AWS_111', 'infra/aws/cloudformation-bootstrap.yml'), // accepted
    checkovEntry('CKV_AWS_1', 'infra/aws/other.yml'), // NOT accepted
  ];
  const isAccepted = (ruleId, filePath) => (
    (ruleId === 'CKV_AWS_18' || ruleId === 'CKV_AWS_111')
    && filePath === 'infra/aws/cloudformation-bootstrap.yml'
  );

  const removed = filterAcceptedCheckovChecks(report, isAccepted);

  assert.equal(removed, 2);
  assert.equal(countCheckovFailedChecks(report), 1);
  assert.equal(report[0].results.failed_checks.length, 0);
  assert.equal(report[1].results.failed_checks.length, 0);
  assert.equal(report[2].results.failed_checks.length, 1);
});

test('filters accepted findings on the object shape and leaves the rest', () => {
  const report = {
    results: { failed_checks: [{ check_id: 'CKV_K8S_35', file_path: 'k8s/base/deployment.yaml' }] },
  };
  const removed = filterAcceptedCheckovChecks(report, (ruleId) => ruleId === 'CKV_K8S_35');
  assert.equal(removed, 1);
  assert.equal(countCheckovFailedChecks(report), 0);
});

test('accepted findings must not survive into the unaccepted count', () => {
  // The regression this guards: a gate that counts before filtering, or
  // cannot parse the array shape, fails on findings the repo accepted.
  const report = [checkovEntry('CKV_AWS_18', 'infra/aws/cloudformation-bootstrap.yml')];
  const before = countCheckovFailedChecks(report);
  assert.equal(before, 1);

  const removed = filterAcceptedCheckovChecks(
    report,
    (ruleId, filePath) => ruleId === 'CKV_AWS_18'
      && filePath === 'infra/aws/cloudformation-bootstrap.yml',
  );
  assert.equal(removed, 1);
  assert.equal(countCheckovFailedChecks(report), 0);
});

test('counts tfsec findings', () => {
  assert.equal(countTfsecFindings({ results: [{ rule_id: 'a' }, { rule_id: 'b' }] }), 2);
  assert.equal(countTfsecFindings({ results: [] }), 0);
  assert.equal(countTfsecFindings({}), 0);
  assert.equal(countTfsecFindings(null), 0);
});

test('counts terrascan violations, ignoring scan errors', () => {
  const report = {
    results: {
      scan_errors: [{ directory: '/repo/infra/staging' }],
      violations: [{ rule_id: 'a' }],
    },
    scan_summary: { violated_policies: 1 },
  };
  assert.equal(countTerrascanViolations(report), 1);
  assert.equal(countTerrascanViolations({ results: {} }), 0);
  assert.equal(countTerrascanViolations(null), 0);
});
