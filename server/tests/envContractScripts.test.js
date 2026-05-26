const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

const runModuleJson = (source) => JSON.parse(execFileSync(
    process.execPath,
    ['--input-type=module', '-e', source],
    {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'test' },
    }
));

const validate = (env) => runModuleJson(`
    import { validateContract } from './scripts/env-contract-lib.mjs';
    const result = validateContract({ env: ${JSON.stringify(env)} });
    console.log(JSON.stringify({ safe: result.safe, failures: result.failures }));
`);

const runScript = (script, env) => {
    try {
        const stdout = execFileSync(
            process.execPath,
            [script],
            {
                cwd: repoRoot,
                encoding: 'utf8',
                env: { ...process.env, ...env },
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        );
        return { status: 0, output: stdout };
    } catch (error) {
        return {
            status: error.status || 1,
            output: `${error.stdout || ''}${error.stderr || ''}`,
        };
    }
};

describe('repo environment contract scripts', () => {
    test('staging env validation fails when SMOKE_BASE_URL is missing', () => {
        const result = validate({
            SMOKE_TARGET_ENV: 'staging',
            STAGING_API_BASE_URL: 'https://api.staging.example.test',
            STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
            STAGING_SSM_PREFIX: '/aura/staging',
        });

        expect(result.safe).toBe(false);
        expect(result.failures.join('\n')).toMatch(/SMOKE_BASE_URL is required/);
    });

    test('staging env validation fails when SMOKE_BASE_URL points to production', () => {
        const result = validate({
            SMOKE_TARGET_ENV: 'staging',
            SMOKE_BASE_URL: 'https://dbtrhsolhec1s.cloudfront.net',
            STAGING_API_BASE_URL: 'https://api.staging.example.test',
            STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
            STAGING_SSM_PREFIX: '/aura/staging',
        });

        expect(result.safe).toBe(false);
        expect(result.failures.join('\n')).toMatch(/known production URL/);
    });

    test('staging env validation fails when preview proxies backend paths to production', () => {
        const result = validate({
            SMOKE_TARGET_ENV: 'staging',
            SMOKE_BASE_URL: 'https://aura-cart-fix-preview-example-mdsaifulislammsis-projects.vercel.app',
            STAGING_API_BASE_URL: 'https://api.staging.example.test',
            STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
            STAGING_SSM_PREFIX: '/aura/staging',
        });

        expect(result.safe).toBe(false);
        expect(result.failures.join('\n')).toMatch(/Vercel Preview URL cannot be accepted as staging/);
    });

    test('staging env validation passes only with staging URLs and /aura/staging', () => {
        const result = validate({
            SMOKE_TARGET_ENV: 'staging',
            SMOKE_BASE_URL: 'https://staging.example.test',
            STAGING_BASE_URL: 'https://staging.example.test',
            STAGING_API_BASE_URL: 'https://api.staging.example.test',
            STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
            STAGING_SSM_PREFIX: '/aura/staging',
        });

        expect(result.safe).toBe(true);
    });

    test('staging env validation rejects mismatched smoke and staging base URLs', () => {
        const result = validate({
            SMOKE_TARGET_ENV: 'staging',
            SMOKE_BASE_URL: 'https://other-staging.example.test',
            STAGING_BASE_URL: 'https://staging.example.test',
            STAGING_API_BASE_URL: 'https://api.staging.example.test',
            STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
            STAGING_SSM_PREFIX: '/aura/staging',
        });

        expect(result.safe).toBe(false);
        expect(result.failures.join('\n')).toMatch(/SMOKE_BASE_URL must equal STAGING_BASE_URL/);
    });

    test('production smoke fails unless explicitly allowed', () => {
        const result = validate({
            SMOKE_TARGET_ENV: 'production',
            SMOKE_BASE_URL: 'https://dbtrhsolhec1s.cloudfront.net',
        });

        expect(result.safe).toBe(false);
        expect(result.failures.join('\n')).toMatch(/ALLOW_PRODUCTION_SMOKE=true/);
    });

    test('prod fallback scanner flags staging fallback to production', () => {
        const result = runModuleJson(`
            import { scanTextForProdFallbacks } from './scripts/scan-prod-fallbacks.mjs';
            const findings = scanTextForProdFallbacks({
                file: 'scripts/example-staging-smoke.mjs',
                text: "const target = process.env.STAGING_URL || process.env.PROD_BASE_URL;\\n",
            });
            console.log(JSON.stringify(findings));
        `);

        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: expect.stringMatching(/falls back/) }),
        ]));
    });

    test('staging smoke contract script fails when staging URL is missing', () => {
        const result = runScript('scripts/smoke/assert-staging-contract.mjs', {
            SMOKE_TARGET_ENV: 'staging',
            STAGING_SSM_PREFIX: '/aura/staging',
            SMOKE_REQUIRE_BACKEND_STAGING: 'true',
            SMOKE_FORBID_PRODUCTION_ORIGINS: 'true',
            PROD_BASE_URL: 'https://prod.example.test',
            PROD_API_BASE_URL: 'https://api.prod.example.test',
            PROD_SSM_PREFIX: '/aura/prod',
        });

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/STAGING_BASE_URL is required/);
    });

    test('staging smoke contract script rejects /aura/prod for staging', () => {
        const result = runScript('scripts/smoke/assert-staging-contract.mjs', {
            SMOKE_TARGET_ENV: 'staging',
            STAGING_BASE_URL: 'https://staging.example.test',
            STAGING_API_BASE_URL: 'https://api.staging.example.test',
            STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
            STAGING_SSM_PREFIX: '/aura/prod',
            SMOKE_REQUIRE_BACKEND_STAGING: 'true',
            SMOKE_FORBID_PRODUCTION_ORIGINS: 'true',
            PROD_BASE_URL: 'https://prod.example.test',
            PROD_API_BASE_URL: 'https://api.prod.example.test',
            PROD_SSM_PREFIX: '/aura/prod',
        });

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/STAGING_SSM_PREFIX must be \/aura\/staging/);
    });

    test('staging smoke contract script passes with isolated staging values', () => {
        const result = runScript('scripts/smoke/assert-staging-contract.mjs', {
            SMOKE_TARGET_ENV: 'staging',
            STAGING_BASE_URL: 'https://staging.example.test',
            STAGING_API_BASE_URL: 'https://api.staging.example.test',
            STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
            STAGING_SSM_PREFIX: '/aura/staging',
            SMOKE_REQUIRE_BACKEND_STAGING: 'true',
            SMOKE_FORBID_PRODUCTION_ORIGINS: 'true',
            PROD_BASE_URL: 'https://prod.example.test',
            PROD_API_BASE_URL: 'https://api.prod.example.test',
            PROD_SSM_PREFIX: '/aura/prod',
        });

        expect(result.status).toBe(0);
        expect(result.output).toMatch(/PASS: staging smoke contract is safe/);
    });

    test('frontend staging target script fails closed when frontend URL is missing', () => {
        const result = runScript('scripts/smoke/assert-frontend-staging-target.mjs', {
            STAGING_API_BASE_URL: 'https://api.staging.example.test',
            STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
            PROD_BASE_URL: 'https://prod.example.test',
            PROD_API_BASE_URL: 'https://api.prod.example.test',
        });

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/STAGING_FRONTEND_URL is required/);
    });

    test('frontend staging target script rejects production frontend URL', () => {
        const result = runScript('scripts/smoke/assert-frontend-staging-target.mjs', {
            STAGING_FRONTEND_URL: 'https://prod.example.test',
            STAGING_API_BASE_URL: 'https://api.staging.example.test',
            STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
            PROD_BASE_URL: 'https://prod.example.test',
            PROD_API_BASE_URL: 'https://api.prod.example.test',
        });

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/must not equal PROD_BASE_URL/);
    });

    test('staging production fallback scanner flags production CloudFront in staging context', () => {
        const findings = runModuleJson(`
            import { scanNoStagingProdFallbacks } from './scripts/smoke/assert-no-staging-prod-fallbacks.mjs';
            import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
            import { tmpdir } from 'node:os';
            import { join } from 'node:path';
            const root = mkdtempSync(join(tmpdir(), 'aura-staging-fallback-'));
            mkdirSync(join(root, 'scripts', 'staging'), { recursive: true });
            writeFileSync(join(root, 'scripts', 'staging', 'bad.mjs'), 'const stagingUrl = "https://dbtrhsolhec1s.cloudfront.net";\\n');
            console.log(JSON.stringify(scanNoStagingProdFallbacks({ root })));
        `);

        expect(findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: expect.stringMatching(/production host/) }),
        ]));
    });

    test('staging operational scripts keep fail-closed staging guards', () => {
        const scriptNames = [
            '11-configure-https-domain.sh',
            '13-backup-staging.sh',
            '14-install-observability.sh',
            '15-cost-watch.sh',
            '16-deploy-all.sh',
        ];

        for (const scriptName of scriptNames) {
            const text = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', scriptName), 'utf8');
            expect(text).toMatch(/assert_staging_prefix/);
        }

        const httpsScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '11-configure-https-domain.sh'), 'utf8');
        expect(httpsScript).toMatch(/ENABLE_STAGING_HTTPS/);
        expect(httpsScript).toMatch(/resolve_dns_ipv4/);

        const backupScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '13-backup-staging.sh'), 'utf8');
        expect(backupScript).toMatch(/assert_staging_bucket_safe/);
        expect(backupScript).toMatch(/backups\//);
        expect(backupScript).toMatch(/STAGING_BACKUP_TRANSPORT/);
        expect(backupScript).toMatch(/ssm send-command/);
        expect(backupScript).toMatch(/ec2-direct-s3/);

        const deployScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '16-deploy-all.sh'), 'utf8');
        expect(deployScript).toMatch(/07-deploy-compose\.sh/);
        expect(deployScript).toMatch(/12-deploy-frontend-docker\.sh/);
        expect(deployScript).toMatch(/10-verify-staging\.sh/);
    });

    test('staging AWS deploy workflow is manual and explicitly gated', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'staging-aws-deploy.yml'), 'utf8');

        expect(workflow).toMatch(/workflow_dispatch/);
        expect(workflow).toMatch(/environment: staging/);
        expect(workflow).toMatch(/deploy_enabled/);
        expect(workflow).toMatch(/STAGING_DEPLOY_ENABLED/);
        expect(workflow).toMatch(/STAGING_SSM_PREFIX.*\/aura\/staging/);
        expect(workflow).toMatch(/PROD_SSM_PREFIX.*\/aura\/prod/);
    });
});
