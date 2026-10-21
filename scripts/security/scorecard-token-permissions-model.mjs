/**
 * The OpenSSF Scorecard `Token-Permissions` model, as ported into this
 * repository.
 *
 * This module is deliberately dependency-free: the drift check
 * (scripts/security/check-scorecard-model-drift.mjs) runs it in a job that
 * does not install the repository's dependencies, so it cannot import
 * anything that needs `npm ci`.
 *
 * The scoring itself lives in
 * scripts/security/check-workflow-token-permissions.mjs, which imports the
 * constants below.
 */

export const MAX_SCORE = 10;
export const MIN_SCORE = 0;

/**
 * Provenance of the model below.
 *
 * The scoring reproduced here is OpenSSF Scorecard's `Token-Permissions`
 * check, mirrored from:
 *
 *   upstream:  https://github.com/ossf/scorecard
 *   release:   v5.6.0
 *   commit:    61e84743356275f6ffca23b1b2f2cb945e19eb96
 *   sources:   checks/raw/permissions.go          (the tracked scopes)
 *              checks/evaluation/permissions.go   (the score arithmetic)
 *              probes/entries.go                  (the probe order)
 *
 * The port is checked against those sources by
 * scripts/security/check-scorecard-model-drift.mjs, which fails when upstream
 * changes the model and this file does not. A hand-port that silently drifts
 * would keep reporting 10/10 while Scorecard's real score dropped - the
 * failure mode this provenance block exists to prevent.
 */
export const MODEL_PROVENANCE = {
    upstream: 'https://github.com/ossf/scorecard',
    release: 'v5.6.0',
    commit: '61e84743356275f6ffca23b1b2f2cb945e19eb96',
    sources: [
        'checks/raw/permissions.go',
        'checks/evaluation/permissions.go',
        'probes/entries.go',
    ],
};

// The scopes Scorecard tracks as "of interest". A write to any of these at the
// TOP level reduces the score; at the JOB level it is allowed but reported.
export const PERMISSIONS_OF_INTEREST = new Set([
    'statuses',
    'checks',
    'security-events',
    'deployments',
    'contents',
    'packages',
    'actions',
]);

// Scorecard's `reduceBy`: how much a top-level write of a given scope costs.
export const TOP_LEVEL_WRITE_PENALTY = {
    checks: 0.5,
    statuses: 0.5,
    contents: MAX_SCORE,
    packages: MAX_SCORE,
    actions: MAX_SCORE,
    deployments: 1.0,
    'security-events': 1.0,
};

// Scorecard's probe order. It matters: the job-level findings are evaluated
// BEFORE the top-level ones, which is what makes a top-level UNDECLARED block
// collapse the score to zero when the same workflow also has a job-level write.
export const PROBE_ORDER = [
    'hasNoGitHubWorkflowPermissionUnknown',
    'jobLevelPermissions',
    'topLevelPermissions',
];
