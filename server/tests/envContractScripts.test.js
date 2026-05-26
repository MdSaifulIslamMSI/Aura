const { execFileSync } = require('child_process');
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
});
