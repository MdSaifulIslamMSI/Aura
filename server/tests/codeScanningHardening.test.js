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
});
