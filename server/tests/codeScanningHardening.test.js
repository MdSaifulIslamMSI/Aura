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
        expect(source).not.toContain("'cmd.exe'");
        expect(source).not.toContain('npx.cmd');
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
        expect(authRoutes).toMatch(/router\.post\('\/recovery-codes', protect, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, authenticatedSessionMutationLimiter/);
        expect(notificationRoutes).toMatch(/router\.use\(protect, userNotificationLimiter\)/);
    });
});
