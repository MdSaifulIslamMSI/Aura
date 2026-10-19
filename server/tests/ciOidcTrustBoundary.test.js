const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const repoRoot = path.join(__dirname, '..', '..');
const workflowsDir = path.join(repoRoot, '.github', 'workflows');

const readRepoFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const readWorkflow = (fileName) => yaml.load(
    fs.readFileSync(path.join(workflowsDir, fileName), 'utf8'),
    { schema: yaml.JSON_SCHEMA }
);
const listWorkflowFiles = () => fs.readdirSync(workflowsDir)
    .filter((fileName) => /\.ya?ml$/i.test(fileName))
    .sort();

/**
 * A job only runs for a `pull_request` event when the workflow declares that
 * trigger and the job condition does not exclude the event.
 *
 * The `inputs` context is only populated for `workflow_dispatch` and
 * `workflow_call`, so a condition that requires an input to hold a specific
 * value can never be satisfied by a pull_request run. `needs.*.outputs` are
 * deliberately NOT used: a skipped dependency leaves the output empty, which
 * is not a property of the event, so those jobs stay "reachable" and keep
 * being checked.
 */
const PULL_REQUEST_EXCLUSION_PATTERNS = [
    // Hard exclusion: the condition requires a non-pull_request event.
    /github\.event_name\s*!=\s*'pull_request'/,
    // The event is pinned to another event name (push, workflow_dispatch, ...).
    /github\.event_name\s*==\s*'(?!pull_request')[^']*'/,
    // A dispatch/workflow_call input is required to hold a literal value;
    // inputs are empty on a pull_request run.
    /inputs\.[A-Za-z0-9_-]+\s*==\s*'[^']*'/,
    /github\.event\.inputs\.[A-Za-z0-9_-]+\s*==\s*'[^']*'/,
];
const PULL_REQUEST_INCLUSION_PATTERN = /github\.event_name\s*==\s*'pull_request'/;

// Splits a job condition on the top-level `||` alternatives only: a condition
// such as "a && (b || c)" keeps its parenthesised group intact, so the whole
// condition is one alternative and a pull_request clause inside the group is
// still seen.
const splitTopLevelAlternatives = (condition) => {
    const alternatives = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index < condition.length - 1; index += 1) {
        const char = condition[index];
        if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
        else if (char === '|' && depth === 0 && condition[index + 1] === '|') {
            alternatives.push(condition.slice(start, index));
            start = index + 2;
            index += 1;
        }
    }
    alternatives.push(condition.slice(start));

    return alternatives.map((alternative) => alternative.trim()).filter(Boolean);
};

const isPullRequestReachable = (job = {}) => {
    const condition = typeof job.if === 'string' ? job.if : '';
    if (!condition.trim()) return true;

    // A job runs on a pull_request event when at least one alternative of its
    // condition can be satisfied by that event.
    return splitTopLevelAlternatives(condition).some((alternative) => {
        if (PULL_REQUEST_INCLUSION_PATTERN.test(alternative)) return true;
        return !PULL_REQUEST_EXCLUSION_PATTERNS.some((pattern) => pattern.test(alternative));
    });
};

const effectivePermissions = (workflow, job = {}) => job.permissions || workflow.permissions || {};
const environmentName = (job = {}) => {
    if (typeof job.environment === 'string') return job.environment;
    if (job.environment && typeof job.environment === 'object') return job.environment.name || '';
    return '';
};
const awsAuthSteps = (job = {}) => (job.steps || []).filter((step) => (
    String(step.uses || '').includes('aws-actions/configure-aws-credentials')
));

describe('CI OIDC trust boundary', () => {
    test('no pull-request reachable job mints an OIDC token inside a GitHub environment', () => {
        // GitHub issues an environment-scoped `sub` claim
        // ("repo:<owner>/<repo>:environment:<env>") for EVERY run of a job that
        // references the environment, including pull_request runs, and GitHub
        // only withholds `id-token: write` for fork pull requests. Combining
        // `id-token: write` with an `environment:` therefore hands a same-repo
        // pull request an environment-scoped subject that is indistinguishable
        // from the reviewed main-branch run the trust policy is meant to
        // allow. A ref-scoped subject is the only claim a pull request cannot
        // forge ("ref:refs/pull/<n>/merge" never matches "ref:refs/heads/main").
        const violations = [];

        for (const fileName of listWorkflowFiles()) {
            const workflow = readWorkflow(fileName);
            const triggers = workflow.on || {};
            if (!triggers.pull_request) continue;

            for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
                if (!isPullRequestReachable(job)) continue;
                if (effectivePermissions(workflow, job)['id-token'] !== 'write') continue;
                if (!environmentName(job)) continue;

                violations.push(
                    `${fileName} job ${jobName}: id-token: write inside environment "${environmentName(job)}" `
                    + 'is reachable from a pull_request trigger'
                );
            }
        }

        expect(violations).toEqual([]);
    });

    test('pull-request reachable AWS credential steps refuse to run on pull requests', () => {
        // The step guard is the second layer only: a pull request can edit the
        // workflow file, so the guard cannot be the trust boundary on its own.
        // It still keeps a pull request from ever reaching
        // sts:AssumeRoleWithWebIdentity with a repository secret in scope.
        const unguarded = [];

        for (const fileName of listWorkflowFiles()) {
            const workflow = readWorkflow(fileName);
            const triggers = workflow.on || {};
            if (!triggers.pull_request) continue;

            for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
                if (!isPullRequestReachable(job)) continue;
                for (const step of awsAuthSteps(job)) {
                    const guard = typeof step.if === 'string' ? step.if : '';
                    if (!guard.includes("github.event_name != 'pull_request'")) {
                        unguarded.push(`${fileName} job ${jobName} step ${step.name || step.uses}`);
                    }
                }
            }
        }

        expect(unguarded).toEqual([]);
    });

    test('every environment-scoped OIDC job excludes the pull_request event explicitly', () => {
        // The first test only asks whether a job is REACHABLE from a pull
        // request, and it treats "requires a dispatch input" as unreachable.
        // That is a GitHub-context subtlety, not a property of the job: a
        // later edit such as `inputs.target == 'production' ||
        // github.event_name == 'pull_request'` would make the job reachable
        // again while the role keeps trusting the environment subject.
        //
        // So the rule is stricter: any job that holds `id-token: write` inside
        // an environment must exclude the pull_request event by name. The
        // trust anchor stays ref-scoped on the role side, and this keeps the
        // workflow side honest about it.
        const unguarded = [];

        for (const fileName of listWorkflowFiles()) {
            const workflow = readWorkflow(fileName);

            for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
                if (effectivePermissions(workflow, job)['id-token'] !== 'write') continue;
                if (!environmentName(job)) continue;

                const condition = typeof job.if === 'string' ? job.if : '';
                if (condition.includes("github.event_name != 'pull_request'")) continue;

                unguarded.push(
                    `${fileName} job ${jobName}: id-token: write inside environment `
                    + `"${environmentName(job)}" must exclude the pull_request event explicitly`
                );
            }
        }

        expect(unguarded).toEqual([]);
    });

    test('the staging release gates anchor their OIDC subject on the main ref', () => {
        // Locks the fix in place: none of the staging gates may declare an
        // environment, because an environment-scoped subject cannot separate a
        // pull request from a reviewed main-branch run.
        const workflow = readWorkflow('giant-release-gates.yml');
        const offenders = Object.entries(workflow.jobs || {})
            .filter(([, job]) => Boolean(environmentName(job)))
            .map(([jobName, job]) => `giant-release-gates.yml job ${jobName}: environment "${environmentName(job)}"`);

        expect(offenders).toEqual([]);

        const unguardedStagingGates = Object.entries(workflow.jobs || {})
            .filter(([, job]) => effectivePermissions(workflow, job)['id-token'] === 'write')
            .flatMap(([jobName, job]) => awsAuthSteps(job)
                .filter((step) => !String(step.if || '').includes("github.event_name != 'pull_request'"))
                .map((step) => `giant-release-gates.yml job ${jobName} step ${step.name || step.uses}`));

        expect(unguardedStagingGates).toEqual([]);
    });

    test('the staging operator role trust policy trusts the main ref subject only', () => {
        // The live role is generated by this script, so the script is where the
        // trust anchor is decided. An environment subject is identical for pull
        // request and non-pull request runs and must never be trusted.
        const iamScript = readRepoFile('scripts/staging/00-create-iam-auth.sh');
        const trustPolicy = iamScript.match(/cat > "\$operator_trust" <<JSON\r?\n([\s\S]*?)\r?\nJSON/);

        expect(trustPolicy).toBeTruthy();
        expect(trustPolicy[1]).toContain('"repo:$github_repo:ref:refs/heads/main"');
        expect(trustPolicy[1]).not.toMatch(/:environment:/);
        expect(trustPolicy[1]).not.toMatch(/environment:staging/);
        // The audience condition is the other half of the trust policy.
        expect(trustPolicy[1]).toContain('"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"');
        // The whole federated statement is still there: only the subject list
        // narrowed, the OIDC provider and the action are unchanged.
        expect(trustPolicy[1]).toContain('"Action": "sts:AssumeRoleWithWebIdentity"');
    });
});
