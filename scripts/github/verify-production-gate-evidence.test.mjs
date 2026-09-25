import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGateTrust } from './verify-production-gate-evidence.mjs';

const pushRun = (path, overrides = {}) => ({
    path,
    event: 'push',
    head_branch: 'main',
    status: 'completed',
    conclusion: 'success',
    ...overrides,
});
const CI = '.github/workflows/ci.yml';
const GRG = '.github/workflows/giant-release-gates.yml';

test('green push runs for both gates on the same main SHA are trusted', () => {
    const trust = computeGateTrust({
        runs: [pushRun(CI), pushRun(GRG)],
        dispatchStagingAck: true,
        stagingPaused: true,
    });
    assert.deepEqual(trust, { qualityTrusted: true, releaseSafetyTrusted: true });
});

test('no runs means nothing is trusted', () => {
    const trust = computeGateTrust({ runs: [], dispatchStagingAck: true, stagingPaused: true });
    assert.deepEqual(trust, { qualityTrusted: false, releaseSafetyTrusted: false });
});

test('failed or in-progress runs are not evidence', () => {
    for (const conclusion of ['failure', 'cancelled', 'startup_failure']) {
        const trust = computeGateTrust({
            runs: [pushRun(CI, { conclusion }), pushRun(GRG, { conclusion })],
            dispatchStagingAck: true,
            stagingPaused: true,
        });
        assert.equal(trust.qualityTrusted, false);
        assert.equal(trust.releaseSafetyTrusted, false);
    }
    const trust = computeGateTrust({
        runs: [pushRun(CI, { status: 'in_progress' }), pushRun(GRG, { status: 'in_progress' })],
        dispatchStagingAck: true,
        stagingPaused: true,
    });
    assert.equal(trust.qualityTrusted, false);
});

test('pull request event runs never count as evidence', () => {
    const trust = computeGateTrust({
        runs: [pushRun(CI, { event: 'pull_request' }), pushRun(GRG, { event: 'pull_request' })],
        dispatchStagingAck: true,
        stagingPaused: true,
    });
    assert.deepEqual(trust, { qualityTrusted: false, releaseSafetyTrusted: false });
});

test('runs from non-main branches are not evidence', () => {
    const trust = computeGateTrust({
        runs: [pushRun(CI, { head_branch: 'feature/x' }), pushRun(GRG, { head_branch: 'feature/x' })],
        dispatchStagingAck: true,
        stagingPaused: true,
    });
    assert.deepEqual(trust, { qualityTrusted: false, releaseSafetyTrusted: false });
});

test('a dispatch demanding live staging gates refuses evidence from an acknowledged-off push run', () => {
    const trust = computeGateTrust({
        runs: [pushRun(CI), pushRun(GRG)],
        dispatchStagingAck: false,
        stagingPaused: true,
    });
    assert.equal(trust.qualityTrusted, true);
    assert.equal(trust.releaseSafetyTrusted, false);
});

test('push evidence is accepted when it ran the stricter staging posture', () => {
    const trust = computeGateTrust({
        runs: [pushRun(CI), pushRun(GRG)],
        dispatchStagingAck: false,
        stagingPaused: false,
    });
    assert.deepEqual(trust, { qualityTrusted: true, releaseSafetyTrusted: true });
});

test('workflow_call runs from the same main SHA count as evidence', () => {
    const trust = computeGateTrust({
        runs: [pushRun(CI, { event: 'workflow_call' }), pushRun(GRG, { event: 'workflow_call' })],
        dispatchStagingAck: true,
        stagingPaused: true,
    });
    assert.deepEqual(trust, { qualityTrusted: true, releaseSafetyTrusted: true });
});

test('a mismatched workflow path is not evidence', () => {
    const trust = computeGateTrust({
        runs: [pushRun('.github/workflows/some-other-workflow.yml')],
        dispatchStagingAck: true,
        stagingPaused: true,
    });
    assert.deepEqual(trust, { qualityTrusted: false, releaseSafetyTrusted: false });
});
