const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const readRepoFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('code scanning hardening contracts', () => {
    test('secret fingerprints use sha256 instead of sha1', () => {
        for (const relativePath of [
            'server/config/authTrustedDeviceFlags.js',
            'server/services/authProfileVault.js',
            'server/services/internalAiTokenService.js',
        ]) {
            const source = readRepoFile(relativePath);
            expect(source).toContain("createHash('sha256')");
            expect(source).not.toContain("createHash('sha1')");
        }
    });

    test('browser and server identifiers avoid Math.random entropy', () => {
        for (const relativePath of [
            'app/src/services/api/recommendationApi.js',
            'app/src/services/clientObservability.js',
            'app/src/store/chatStore.js',
            'server/services/ai/commerceAssistantService.js',
            'server/tests/helpers/securityTestHelpers.js',
        ]) {
            expect(readRepoFile(relativePath)).not.toContain('Math.random');
        }
    });

    test('staging Vercel automation invokes the trusted npx JavaScript entrypoint directly', () => {
        const source = readRepoFile('scripts/staging/vercel-staging-autopilot.mjs');
        expect(source).toContain("'npx-cli.js'");
        expect(source).toContain("fs.mkdtempSync(path.join(os.tmpdir(), 'aura-vercel-api-'))");
        expect(source).not.toContain("'cmd.exe'");
        expect(source).not.toContain('npx.cmd');
        expect(source).not.toContain('`aura-vercel-api-${Date.now()}.json`');
    });

    test('local S3 mock does not reflect bucket input into redirect headers', () => {
        const source = readRepoFile('bin/localstack-server.js');
        expect(source).toContain("'Location': '/'");
        expect(source).not.toContain("'Location': `/${bucketName}`");
    });

    test('auth and notification mutations retain explicit route throttling', () => {
        const authRoutes = readRepoFile('server/routes/authRoutes.js');
        const notificationRoutes = readRepoFile('server/routes/userNotificationRoutes.js');

        expect(authRoutes).toMatch(/router\.post\('\/logout', protectOptional, authenticatedSessionMutationLimiter/);
        expect(authRoutes).toMatch(/router\.post\('\/recovery-codes', protect, authenticatedSessionMutationLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth/);
        expect(notificationRoutes).toMatch(/router\.use\(protect, userNotificationLimiter\)/);
    });

    test('security scanner reports avoid check-then-write races', () => {
        const source = readRepoFile('scripts/security/run-docker-tool.mjs');
        expect(source).toContain("{ flag: 'wx' }");
        expect(source).not.toMatch(
            /if\s*\(\s*!fs\.existsSync\(reportPath\)\s*\)\s*\{\s*fs\.writeFileSync\(reportPath/
        );
    });

    test('catalog snapshot defaults use a private temporary directory', () => {
        const source = readRepoFile('server/services/catalogSnapshotService.js');
        expect(source).toContain("fs.mkdtempSync(path.join(os.tmpdir(), 'aura-catalog-snapshots-'))");
    });

    test('Checkov workflow and infrastructure findings stay explicitly handled', () => {
        expect(readRepoFile('.github/workflows/staging-smoke.yml')).toMatch(/permissions:\s*\n\s+contents: read/);
        expect(readRepoFile('.github/workflows/staging-frontend-smoke.yml')).toMatch(/permissions:\s*\n\s+contents: read/);
        expect(readRepoFile('.github/workflows/status-watch.yml')).toContain('permissions: {}');

        const deployment = readRepoFile('k8s/base/deployment.yaml');
        expect(deployment).toContain('runAsUser: 10001');
        expect(deployment).toContain('runAsGroup: 10001');
        expect(deployment).toContain('fsGroup: 10001');
        expect(deployment).toContain('checkov.io/skip1: CKV_K8S_35=');
        expect(deployment).toContain('checkov.io/skip2: CKV_K8S_43=');

        expect(readRepoFile('docker-compose.yml')).toContain('#checkov:skip=CKV_SECRET_6:Local demo placeholder');
        expect(readRepoFile('k8s/base/secret.example.yaml')).toContain('#checkov:skip=CKV_SECRET_6:Example placeholder');

        const cloudFormation = readRepoFile('infra/aws/cloudformation-bootstrap.yml');
        expect(cloudFormation).toContain('AccessLogBucket:');
        expect(cloudFormation).toContain('LoggingConfiguration:');
        expect(cloudFormation).toContain('DestinationBucketName: !Ref AccessLogBucket');
        expect(cloudFormation).toContain('#checkov:skip=CKV_AWS_111:');
    });

    test('operator-controlled workflow_dispatch inputs stay explicitly accepted for CKV_GHA_7', () => {
        const dockerRunner = readRepoFile('scripts/security/run-docker-tool.mjs');
        for (const workflow of [
            '.github/workflows/production-on-push.yml',
            '.github/workflows/production-db-backup.yml',
            '.github/workflows/observability-activation.yml',
        ]) {
            const accepted = dockerRunner.includes(`path: '${workflow}'`);
            expect(accepted).toBe(true);
        }
    });

    test('AWS OIDC workflows scope id-token to the jobs that mint tokens', () => {
        const expectedJobTokens = {
            '.github/workflows/production-db-backup.yml': 4,
            '.github/workflows/observability-activation.yml': 1,
        };
        for (const [relativePath, expectedCount] of Object.entries(expectedJobTokens)) {
            const source = readRepoFile(relativePath);
            // The first (workflow-level) permissions block grants only
            // contents: read; id-token: write belongs to individual jobs.
            expect(source).toMatch(/^permissions:\r?\n\s+contents: read\r?\n\r?\n/m);
            expect((source.match(/id-token: write/g) || []).length).toBe(expectedCount);
        }
    });

    test('Sentry release uploads validate the release id before shell dispatch', () => {
        const source = readRepoFile('scripts/student-pack-sentry-release.mjs');
        expect(source).toContain("'/d', '/c', sentryCommand");
        // The release id is charset-validated BEFORE any dispatch: every argv
        // token is a constant string except `release`, which the strict
        // allowlist strips of all shell metacharacters.
        expect(source).toContain('/^[A-Za-z0-9][A-Za-z0-9._+@/-]{0,199}$/.test(release)');
        expect(source).toContain("run(['releases', 'new', release]);");
        expect(source).toContain("run(['releases', 'finalize', release]);");
        // The env var still rides along for sentry-cli subcommands that do
        // read it, but the version-bearing commands pass the validated id as
        // argv: sentry-cli 3.4.2 has no SENTRY_RELEASE fallback for
        // `releases new <VERSION>` (verified against the pinned CLI).
        expect(source).toContain('SENTRY_RELEASE: release');
        expect(source).not.toContain("'--release', release");
    });

    test('PQC semgrep policy only flags signing operations, not algorithm mentions', () => {
        const policy = readRepoFile('security/semgrep/pqc-crypto-policy.yml');
        expect(policy).toContain('pattern: jwt.sign(...)');
        expect(policy).toContain('pattern: new SignJWT(...)');
        expect(policy).not.toContain('$JWT.sign(...)');
        expect(policy).not.toContain('RS256|ES256|PS256');
        expect(policy).toContain('tests/fixtures/security/pqc/**');
        // Accepted hash sites are excluded at the rule level (the operative
        // mechanism; inline nosemgrep comments alone did not suppress):
        expect(policy).toContain('- server/services/productImageResolver.js');
        expect(policy).toContain('- server/services/catalogArtworkService.js');
        expect(policy).toContain('- server/services/listingService.js');
    });

    test('workflows keep the GITHUB_TOKEN top level read-only', () => {
        // Scorecard's Token-Permissions check only emits SARIF results while
        // its score is below the policy minimum, so a top-level write scope
        // silently re-opens a `TokenPermissionsID` code-scanning alert on the
        // next weekly Scorecard run. The full model is reproduced by
        // scripts/security/check-workflow-token-permissions.mjs (wired into
        // the Security Gates workflow); this pins the load-bearing half of it
        // in the server test tier, where it runs on every pull request.
        //
        // The check is textual on purpose: the server test tier installs only
        // server/node_modules, so it cannot depend on a YAML parser.
        // The scopes Scorecard treats as "of interest": a write to any of them
        // at the top level reduces its Token-Permissions score and emits a
        // code-scanning alert. Other scopes (id-token, attestations,
        // pull-requests, issues) are recorded as unknown and never affect the
        // score, so they are not violations here either.
        const trackedScopes = new Set([
            'actions',
            'checks',
            'contents',
            'deployments',
            'packages',
            'security-events',
            'statuses',
        ]);

        const workflowDir = path.join(repoRoot, '.github', 'workflows');
        const offenders = [];

        for (const name of fs.readdirSync(workflowDir).filter((file) => /\.ya?ml$/i.test(file))) {
            const lines = fs.readFileSync(path.join(workflowDir, name), 'utf8').split(/\r?\n/);
            for (let index = 0; index < lines.length; index += 1) {
                const topLevel = /^permissions:\s*(.*)$/.exec(lines[index]);
                if (!topLevel) continue;
                if (topLevel[1].trim().length > 0) {
                    // `read-all` and `{}` are read-only; `write-all` is not.
                    if (/^write-all$/i.test(topLevel[1].trim())) {
                        offenders.push(`${name}: permissions: ${topLevel[1].trim()}`);
                    }
                    continue;
                }
                for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
                    if (!/^\s+\S/.test(lines[cursor])) break;
                    const scope = lines[cursor].trim();
                    const [scopeName, scopeValue] = scope.split(':').map((part) => part.trim());
                    if (trackedScopes.has(scopeName) && scopeValue === 'write') {
                        offenders.push(`${name}: ${scope}`);
                    }
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    test('allowlisted hash sites carry fully qualified nosemgrep annotations', () => {
        // Semgrep namespaces local-config rules by their config path, so the
        // effective rule id is security.semgrep.<rule> and the inline
        // annotation must use the fully qualified form to match.
        const expectations = [
            ['server/services/listingService.js', 'nosemgrep: security.semgrep.nodejs-md5'],
            ['server/services/productImageResolver.js', 'nosemgrep: security.semgrep.nodejs-sha1'],
            ['server/services/catalogArtworkService.js', 'nosemgrep: security.semgrep.nodejs-sha1'],
            ['scripts/i18n/codemod-jsx-stable-text.mjs', 'nosemgrep: security.semgrep.nodejs-sha1'],
            ['scripts/i18n/discover-stable-ui-text.mjs', 'nosemgrep: security.semgrep.nodejs-sha1'],
        ];
        for (const [relativePath, annotation] of expectations) {
            expect(readRepoFile(relativePath)).toContain(annotation);
        }
    });
});
