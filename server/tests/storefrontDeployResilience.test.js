const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const repoRoot = path.join(__dirname, '..', '..');
const readRepoFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const WORKFLOWS = [
    '.github/workflows/deploy-frontend-aws.yml',
    '.github/workflows/deploy-netlify.yml',
];

const stepsOf = (workflow) => {
    const parsed = yaml.load(readRepoFile(workflow));
    const steps = [];
    for (const [jobName, job] of Object.entries(parsed.jobs || {})) {
        for (const step of job.steps || []) {
            steps.push({ jobName, name: step.name || '', step });
        }
    }
    return steps;
};

/**
 * The storefront production deploy must not be blocked by an optional
 * third-party artifact upload, and must still be blocked when unminified
 * source would reach the public origin.
 *
 * The Sentry release/sourcemap upload is telemetry. Sentry's release API
 * rate-limits (HTTP 429), and a rate limit on a third-party API must not fail
 * the production storefront deploy - the workflow's own comment already
 * declares that this step "never blocks deploys". The sourcemap prune that
 * follows is the security-relevant half: it is what guarantees no unminified
 * source is published to the origin, so it must stay hard-failing.
 */
describe('storefront deploy resilience', () => {
    for (const workflow of WORKFLOWS) {
        test(`${workflow} keeps the Sentry upload from blocking the deploy`, () => {
            const sentrySteps = stepsOf(workflow).filter((s) => s.name === 'Publish Sentry release and sourcemaps');
            expect(sentrySteps.length).toBe(1);
            const [{ step }] = sentrySteps;
            expect(step['continue-on-error']).toBe(true);
            // The upload itself still guards on the token in the shell.
            expect(String(step.run)).toContain('SENTRY_AUTH_TOKEN');
        });

        test(`${workflow} cannot publish to production Sentry from a pull request`, () => {
            const parsed = yaml.load(readRepoFile(workflow));
            const triggers = parsed.on || parsed[true] || {};
            const reachableFromPullRequest = Object.prototype.hasOwnProperty.call(triggers, 'pull_request');
            const sentrySteps = stepsOf(workflow).filter((s) => s.name === 'Publish Sentry release and sourcemaps');
            const [{ step }] = sentrySteps;

            if (reachableFromPullRequest) {
                // A pull request must not publish a release to the production
                // Sentry project with the production release token.
                expect(String(step.if)).toContain("github.event_name != 'pull_request'");
                // The secrets context stays out of the condition.
                expect(String(step.if)).not.toContain('secrets.');
            } else {
                // Not pull-request reachable, so the guard is not required -
                // but the step must still never run unguarded if that changes.
                expect(step.if === undefined || String(step.if).includes("github.event_name != 'pull_request'")).toBe(true);
            }
        });

        test(`${workflow} keeps the sourcemap prune hard-failing`, () => {
            const pruneSteps = stepsOf(workflow).filter((s) => s.name === 'Strip sourcemaps from the deploy payload');
            expect(pruneSteps.length).toBe(1);
            const [{ step }] = pruneSteps;
            // No continue-on-error: a leftover .map must fail the deploy.
            expect(step['continue-on-error']).toBeUndefined();
            expect(String(step.run)).toContain('sourcemaps still present after prune');
        });

        test(`${workflow} is valid YAML with no duplicate step keys`, () => {
            const parsed = yaml.load(readRepoFile(workflow));
            expect(parsed).toBeTruthy();
            expect(Object.keys(parsed.jobs || {}).length).toBeGreaterThan(0);
        });
    }
});
