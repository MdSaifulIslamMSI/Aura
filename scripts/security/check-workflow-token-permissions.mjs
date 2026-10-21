#!/usr/bin/env node
/**
 * Fails when the repository's GitHub Actions workflows would score below 10 on
 * the OpenSSF Scorecard `Token-Permissions` check.
 *
 * WHY THIS EXISTS: `ossf-scorecard.yml` runs Scorecard weekly and uploads its
 * SARIF to GitHub code scanning. Scorecard only emits SARIF results for a check
 * whose score is BELOW the policy minimum, so every workflow permission
 * violation silently becomes a `TokenPermissionsID` code-scanning alert. The
 * alerts stay open until the score is restored, and a workflow edit that
 * reintroduces a top-level write re-opens them with no local signal.
 *
 * This gate reproduces Scorecard's Token-Permissions scoring locally so the
 * violation is caught in CI instead of in the security tab:
 *
 *   1. Raw findings are collected per workflow file, exactly like
 *      `checks/raw/permissions.go`:
 *        - top-level `permissions:` absent        -> undeclared
 *        - `permissions: read-all` / scope map    -> read (or none / write)
 *        - a job without its own `permissions:`    -> undeclared (job level)
 *      Only the seven scopes Scorecard tracks as "of interest" (`actions`,
 *      `checks`, `contents`, `deployments`, `packages`, `security-events`,
 *      `statuses`) can produce a write finding; other scopes are recorded as
 *      `unknown` and never affect the score.
 *   2. Findings are evaluated in Scorecard's probe order
 *      (job level before top level), which is what makes a top-level
 *      UNDECLARED block combined with any job-level write collapse the score
 *      to zero.
 *   3. The score is the same arithmetic as
 *      `checks/evaluation/permissions.go`: start at 10, subtract the
 *      top-level penalties, and clamp at 0.
 *
 * The exit code is 0 only when the score is exactly 10 - that is, when
 * Scorecard would emit no SARIF result for this check at all.
 *
 * Exit code 0 = pass, 1 = fail.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = path.join(repoRoot, '.github', 'workflows');

const MAX_SCORE = 10;
const MIN_SCORE = 0;

// The scopes Scorecard tracks as "of interest". A write to any of these at the
// TOP level reduces the score; at the JOB level it is allowed but reported.
const PERMISSIONS_OF_INTEREST = new Set([
    'statuses',
    'checks',
    'security-events',
    'deployments',
    'contents',
    'packages',
    'actions',
]);

// Scorecard's `reduceBy`: how much a top-level write of a given scope costs.
const TOP_LEVEL_WRITE_PENALTY = {
    checks: 0.5,
    statuses: 0.5,
    contents: MAX_SCORE,
    packages: MAX_SCORE,
    actions: MAX_SCORE,
    deployments: 1.0,
    'security-events': 1.0,
};

// Actions whose SARIF upload makes `security-events: write` expected, so
// Scorecard ignores that scope for the whole workflow.
const SARIF_UPLOAD_ACTIONS = new Set([
    'github/codeql-action/analyze',
    'github/codeql-action/upload-sarif',
    'ossf/scorecard-action',
    'haskell-actions/hlint-scan',
    'zizmorcore/zizmor-action',
]);

const toBaseAction = (uses) => String(uses || '').split('@')[0].trim();

const stepUses = (step) => (typeof step?.uses === 'string' ? step.uses : null);

const stepRun = (step) => (typeof step?.run === 'string' ? step.run : null);

const jobsOf = (workflow) => (workflow && typeof workflow.jobs === 'object' && workflow.jobs ? workflow.jobs : {});

/**
 * Mirrors `fileparser.JobMatcher.matches`: every matcher step must be matched
 * by some step of the job (reusable-workflow calls count as a match).
 */
const jobMatches = (job, matcher) => {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    for (const wanted of matcher.steps) {
        let matched = false;
        if (wanted.uses && typeof job?.uses === 'string' && job.uses.startsWith(`${wanted.uses}@`)) {
            return true;
        }
        for (const step of steps) {
            if (wanted.uses) {
                const uses = stepUses(step);
                if (!uses || !uses.startsWith(`${wanted.uses}@`)) continue;
            }
            if (wanted.run) {
                const run = stepRun(step);
                if (!run || !new RegExp(wanted.run).test(run.replace(/\\(\n|\r|\r\n)/g, ''))) continue;
            }
            if (wanted.with) {
                const withInputs = step?.with;
                if (!withInputs || typeof withInputs !== 'object') continue;
                const mismatch = Object.entries(wanted.with)
                    .some(([key, value]) => withInputs[key] !== value);
                if (mismatch) continue;
            }
            matched = true;
            break;
        }
        if (!matched) return false;
    }
    return true;
};

const anyJobMatches = (workflow, matchers) => Object.values(jobsOf(workflow))
    .some((job) => matchers.some((matcher) => jobMatches(job, matcher)));

// `fileparser.IsPackagingWorkflow` - packaging workflows legitimately need
// `packages: write`.
const isPackagingWorkflow = (workflow) => anyJobMatches(workflow, [
    { steps: [{ uses: 'actions/setup-node', with: { 'registry-url': 'https://registry.npmjs.org' } }, { run: 'npm.*publish' }] },
    { steps: [{ uses: 'actions/setup-java' }, { run: 'mvn.*deploy' }] },
    { steps: [{ uses: 'actions/setup-java' }, { run: 'gradle.*publish' }] },
    { steps: [{ run: 'sbt.*ci-release' }] },
    { steps: [{ run: 'gem.*push' }] },
    { steps: [{ run: 'nuget.*push' }] },
    { steps: [{ run: 'docker.*push' }] },
    { steps: [{ uses: 'docker/build-push-action' }] },
    { steps: [{ uses: 'pypa/gh-action-pypi-publish' }] },
    { steps: [{ uses: 'relekang/python-semantic-release' }] },
    { steps: [{ uses: 'goreleaser/goreleaser-action' }] },
    { steps: [{ run: 'cargo.*publish' }] },
    { steps: [{ uses: 'imjasonh/setup-ko' }] },
    { steps: [{ uses: 'ko-build/setup-ko' }] },
    { steps: [{ run: 'npx.*semantic-release' }] },
    { steps: [{ uses: 'erlef/setup-elixir' }, { run: '.*hex.publish.*' }] },
]);

// `raw.isReleasingWorkflow` / `raw.isGitHubPagesDeploymentWorkflow` - release
// workflows legitimately need `contents: write`.
const isReleasingWorkflow = (workflow) => anyJobMatches(workflow, [
    { steps: [{ uses: 'relekang/python-semantic-release' }] },
    { steps: [{ run: '(npx|pnpm|yarn).*semantic-release' }] },
    { steps: [{ uses: 'actions/setup-go' }, { uses: 'goreleaser/goreleaser-action' }] },
    { steps: [{ uses: 'slsa-framework/slsa-github-generator/.github/workflows/builder_go_slsa3.yml' }] },
    { steps: [{ uses: 'slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml' }] },
    { steps: [{ run: '.*mvn.*release:prepare.*' }] },
]);

const isGitHubPagesDeploymentWorkflow = (workflow) => anyJobMatches(workflow, [
    { steps: [{ uses: 'peaceiris/actions-gh-pages' }] },
]);

const isSarifUploadWorkflow = (workflow) => Object.values(jobsOf(workflow))
    .some((job) => (Array.isArray(job?.steps) ? job.steps : [])
        .some((step) => {
            const uses = stepUses(step);
            return uses ? SARIF_UPLOAD_ACTIONS.has(toBaseAction(uses)) : false;
        }));

const ignoredScopesFor = (workflow) => {
    const ignored = new Set();
    if (isPackagingWorkflow(workflow)) ignored.add('packages');
    if (isReleasingWorkflow(workflow) || isGitHubPagesDeploymentWorkflow(workflow)) ignored.add('contents');
    if (isSarifUploadWorkflow(workflow)) ignored.add('security-events');
    return ignored;
};

const PERMISSION_LEVEL = {
    READ: 'read',
    WRITE: 'write',
    NONE: 'none',
    UNDECLARED: 'undeclared',
    UNKNOWN: 'unknown',
};

/**
 * Mirrors `raw.validatePermissions`. Returns the raw findings for one
 * `permissions:` block.
 */
const collectPermissionFindings = (permissions, location, path, ignored) => {
    const findings = [];
    const allIsSet = typeof permissions === 'string' && permissions !== '';
    const scopeIsSet = permissions && typeof permissions === 'object' && Object.keys(permissions).length > 0;

    if (!allIsSet && !scopeIsSet) {
        findings.push({ path, location, level: PERMISSION_LEVEL.NONE, name: null, value: 'none' });
        return findings;
    }

    if (allIsSet) {
        const value = permissions;
        if (value.toLowerCase() !== 'read-all' && value !== '') {
            findings.push({ path, location, level: PERMISSION_LEVEL.WRITE, name: value, value });
            return findings;
        }
        findings.push({ path, location, level: PERMISSION_LEVEL.READ, name: null, value });
        return findings;
    }

    for (const [scope, value] of Object.entries(permissions)) {
        if (typeof value !== 'string') continue;
        if (value.toLowerCase() === 'write') {
            const tracked = PERMISSIONS_OF_INTEREST.has(scope.toLowerCase())
                && !ignored.has(scope.toLowerCase());
            findings.push({
                path,
                location,
                level: tracked ? PERMISSION_LEVEL.WRITE : PERMISSION_LEVEL.UNKNOWN,
                name: scope,
                value,
            });
            continue;
        }
        const level = value === 'read' || value === 'read-all'
            ? PERMISSION_LEVEL.READ
            : (value === 'none' ? PERMISSION_LEVEL.NONE : PERMISSION_LEVEL.UNKNOWN);
        findings.push({ path, location, level, name: scope, value });
    }
    return findings;
};

/**
 * Mirrors `raw.TokenPermissions`: top-level findings first, then job-level.
 */
const collectWorkflowFindings = (relativePath, workflow) => {
    const findings = [];
    const ignored = ignoredScopesFor(workflow);

    if (workflow?.permissions === undefined) {
        findings.push({
            path: relativePath,
            location: 'top',
            level: PERMISSION_LEVEL.UNDECLARED,
            name: null,
            value: null,
        });
    } else {
        findings.push(...collectPermissionFindings(workflow.permissions, 'top', relativePath, ignored));
    }

    for (const job of Object.values(jobsOf(workflow))) {
        if (job?.permissions === undefined) {
            findings.push({
                path: relativePath,
                location: 'job',
                level: PERMISSION_LEVEL.UNDECLARED,
                name: null,
                value: null,
            });
            continue;
        }
        findings.push(...collectPermissionFindings(job.permissions, 'job', relativePath, ignored));
    }

    return findings;
};

/**
 * Mirrors `checks/evaluation/permissions.go` with Scorecard's probe order:
 * job-level findings are evaluated before top-level findings.
 */
const evaluate = (findings) => {
    let score = MAX_SCORE;
    const hasWrite = { top: new Map(), job: new Map() };
    const undeclared = { top: new Map(), job: new Map() };
    const warnings = [];

    const touch = (map, key) => {
        if (!map.has(key)) map.set(key, false);
    };

    const jobFindings = findings.filter((finding) => finding.location === 'job');
    const topFindings = findings.filter((finding) => finding.location === 'top');

    for (const finding of [...jobFindings, ...topFindings]) {
        const key = finding.path;
        touch(hasWrite.top, key);
        touch(hasWrite.job, key);
        touch(undeclared.top, key);
        touch(undeclared.job, key);

        if (finding.level === PERMISSION_LEVEL.NONE) continue;
        if (finding.level === PERMISSION_LEVEL.UNDECLARED) {
            if (finding.location === 'job') {
                undeclared.job.set(key, true);
                if (hasWrite.top.get(key) || undeclared.top.get(key)) score = MIN_SCORE;
                continue;
            }
            undeclared.top.set(key, true);
            if (hasWrite.job.get(key)) score = MIN_SCORE;
            else score -= 0.5;
            warnings.push({ ...finding, text: 'no top permission defined' });
            continue;
        }
        if (finding.level !== PERMISSION_LEVEL.WRITE) continue;

        if (finding.location === 'job') {
            hasWrite.job.set(key, true);
            warnings.push({ ...finding, text: `jobLevel '${finding.name}' permission set to '${finding.value}'` });
            continue;
        }

        hasWrite.top.set(key, true);
        const isWriteAll = finding.name === 'write-all' || finding.name === 'all';
        if (isWriteAll) {
            warnings.push({ ...finding, text: `topLevel '${finding.name}' permission set to '${finding.value}'` });
            if (hasWrite.job.get(key) || undeclared.job.get(key)) return { score: MIN_SCORE, warnings };
            score -= 0.5;
            continue;
        }
        score -= TOP_LEVEL_WRITE_PENALTY[finding.name.toLowerCase()] ?? 0;
        warnings.push({ ...finding, text: `topLevel '${finding.name}' permission set to '${finding.value}'` });
    }

    return { score: Math.max(MIN_SCORE, score), warnings };
};

const listWorkflowFiles = (workflowDir) => {
    if (!fs.existsSync(workflowDir)) return [];
    return fs.readdirSync(workflowDir)
        .filter((name) => /\.ya?ml$/i.test(name))
        .sort();
};

export const auditWorkflowTokenPermissions = (root = repoRoot) => {
    const workflowDir = path.join(root, '.github', 'workflows');
    const workflowFiles = listWorkflowFiles(workflowDir);
    const findings = [];
    const parseErrors = [];

    for (const name of workflowFiles) {
        const absolute = path.join(workflowDir, name);
        const relative = path.join('.github', 'workflows', name);
        const source = fs.readFileSync(absolute, 'utf8');
        // `fileparser.CheckFileContainsCommands`: a file made only of comments
        // is not a workflow.
        const hasCommands = source.split(/\r?\n/)
            .map((line) => line.trim())
            .some((line) => line.length > 0 && !line.startsWith('#'));
        if (!hasCommands) continue;

        let workflow;
        try {
            workflow = yaml.load(source);
        } catch (error) {
            parseErrors.push(`${relative}: ${error.message}`);
            continue;
        }
        findings.push(...collectWorkflowFindings(relative, workflow));
    }

    const { score, warnings } = evaluate(findings);
    return { score, warnings, parseErrors, workflowCount: workflowFiles.length };
};

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
    const result = auditWorkflowTokenPermissions();
    for (const error of result.parseErrors) {
        console.error(`[security:workflow-token-permissions] ${error}`);
    }
    if (result.parseErrors.length > 0) {
        console.error('[security:workflow-token-permissions] FAILED - a workflow could not be parsed.');
        process.exitCode = 1;
    } else if (result.score >= MAX_SCORE) {
        console.log(
            `[security:workflow-token-permissions] PASS - ${result.workflowCount} workflow(s) scored `
            + `${result.score}/${MAX_SCORE} on the Scorecard Token-Permissions model.`
        );
    } else {
        console.error(
            `[security:workflow-token-permissions] FAILED - Token-Permissions scored ${result.score}/${MAX_SCORE}. `
            + 'Scorecard emits a code-scanning alert for every violation below, so these must be cleared.'
        );
        for (const warning of result.warnings) {
            console.error(`- ${warning.path}: ${warning.text}`);
        }
        console.error(
            'Fix: declare a read-only top-level `permissions:` block in the workflow and move every '
            + 'required write scope to the job that actually needs it.'
        );
        process.exitCode = 1;
    }
}
