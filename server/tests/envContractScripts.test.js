const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
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

const runScript = (script, env, args = []) => {
    try {
        const stdout = execFileSync(
            process.execPath,
            [script, ...args],
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

const runScriptAsync = (script, env, args = []) => new Promise((resolve) => {
    execFile(
        process.execPath,
        [script, ...args],
        {
            cwd: repoRoot,
            encoding: 'utf8',
            env: { ...process.env, ...env },
        },
        (error, stdout, stderr) => {
            resolve({
                status: error?.code || 0,
                output: `${stdout || ''}${stderr || ''}`,
            });
        }
    );
});

const writeTempEnvFile = (contents) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-auth-smoke-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, contents);
    return file;
};

const blankAuthSmokeEnv = {
    AUTH_PROVIDER: '',
    AUTH_ISSUER_URL: '',
    AUTH_CLIENT_ID: '',
    AUTH_CLIENT_TYPE: '',
    AUTH_CLIENT_SECRET: '',
    AUTH_OIDC_STATE_SECRET: '',
    AUTH_VAULT_SECRET: '',
    AUTH_AUDIENCE: '',
    AUTH_JWKS_URL: '',
    AUTH_REDIRECT_URI: '',
    AUTH_POST_LOGOUT_REDIRECT_URI: '',
};

const pathEnvName = process.platform === 'win32' ? 'Path' : 'PATH';

const writeMockAwsCli = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-aws-mock-'));
    const mockScript = path.join(dir, 'aws-mock.cjs');
    fs.writeFileSync(mockScript, `
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('aws-cli/2.99.0 Python/3.12');
  process.exit(0);
}
if (args[0] === 'configure' && args[1] === 'get' && args[3] === '--profile' && args[4] === 'aura-staging-operator') {
  const key = args[2];
  if (process.env.AWS_MOCK_PROFILE_MODE === 'staging-role') {
    const values = {
      source_profile: 'aura-admin-cli',
      role_arn: 'arn:aws:iam::123456789012:role/aura-staging-bootstrap-operator',
    };
    if (values[key]) {
      console.log(values[key]);
      process.exit(0);
    }
    process.exit(1);
  }
  if (process.env.AWS_MOCK_PROFILE_MODE === 'production-role') {
    const values = {
      source_profile: 'aura-admin-cli',
      role_arn: 'arn:aws:iam::123456789012:role/aura-production-admin',
    };
    if (values[key]) {
      console.log(values[key]);
      process.exit(0);
    }
    process.exit(1);
  }
  if (process.env.AWS_MOCK_PROFILE_MODE === 'direct-static') {
    const values = {
      aws_access_key_id: 'AKIA_TEST_DO_NOT_PRINT',
      aws_secret_access_key: 'test-placeholder-do-not-print-secret',
    };
    if (values[key]) {
      console.log(values[key]);
      process.exit(0);
    }
    process.exit(1);
  }
  const values = {
    sso_session: 'aura-staging',
    sso_account_id: '123456789012',
    sso_role_name: 'AuraStagingReleaseGateOperator',
  };
  if (values[key]) {
    console.log(values[key]);
    process.exit(0);
  }
  process.exit(1);
}
if (args[0] === 'configure' && args[1] === 'set' && args[4] === '--profile' && args[5] === 'aura-staging-operator') {
  if (process.env.AWS_MOCK_MODE === 'configure-fail') {
    console.error('mock configure set failed');
    process.exit(1);
  }
  console.log('mock configured ' + args[2]);
  process.exit(0);
}
if (args.join(' ') === 'sts get-caller-identity --output json') {
  if (process.env.AWS_MOCK_MODE === 'missing-creds') {
    console.error('Unable to locate credentials.');
    process.exit(254);
  }
  console.log(JSON.stringify({
    UserId: 'AROAEXAMPLE:sso-session',
    Account: '123456789012',
    Arn: 'arn:aws:sts::123456789012:assumed-role/aura-staging-operator/session'
  }));
  process.exit(0);
}
console.error('unexpected aws mock args: ' + args.join(' '));
process.exit(2);
`);
    fs.writeFileSync(path.join(dir, 'aws.cmd'), '@echo off\r\nnode "%~dp0aws-mock.cjs" %*\r\n');
    const shPath = path.join(dir, 'aws');
    fs.writeFileSync(shPath, '#!/usr/bin/env sh\nnode "$(dirname "$0")/aws-mock.cjs" "$@"\n');
    fs.chmodSync(shPath, 0o755);
    return { dir, command: process.platform === 'win32' ? path.join(dir, 'aws.cmd') : shPath };
};

const safeLocalReleaseEnv = (mockBin, overrides = {}) => ({
    [pathEnvName]: `${mockBin.dir}${path.delimiter}${process.env[pathEnvName] || process.env.PATH || ''}`,
    AWS_CLI_PATH: mockBin.command,
    AWS_MOCK_MODE: 'success',
    AWS_PROFILE: 'aura-staging-operator',
    AWS_REGION: 'ap-south-1',
    SMOKE_TARGET_ENV: 'staging',
    SMOKE_BASE_URL: 'https://staging.example.test',
    STAGING_BASE_URL: 'https://staging.example.test',
    STAGING_FRONTEND_URL: 'https://staging.example.test',
    STAGING_API_BASE_URL: 'https://api.staging.example.test',
    STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
    STAGING_SSM_PREFIX: '/aura/staging',
    SMOKE_REQUIRE_BACKEND_STAGING: 'true',
    SMOKE_FORBID_PRODUCTION_ORIGINS: 'true',
    PROD_BASE_URL: 'https://prod.example.test',
    PROD_API_BASE_URL: 'https://api.prod.example.test',
    PROD_SSM_PREFIX: '/aura/prod',
    ...overrides,
});

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

    test('staging frontend smoke workflow points SMOKE_BASE_URL at the frontend base URL', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'staging-frontend-smoke.yml'), 'utf8');

        expect(workflow).toMatch(/SMOKE_BASE_URL:\s*\$\{\{\s*vars\.STAGING_BASE_URL\s*\}\}/);
        expect(workflow).not.toMatch(/SMOKE_BASE_URL:\s*\$\{\{\s*vars\.STAGING_API_BASE_URL\s*\}\}/);
        expect(workflow).toMatch(/SMOKE_REQUIRE_SCANNER_READY/);
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

    test('local release credential checker fails when AWS credentials are absent', () => {
        const mockBin = writeMockAwsCli();
        const result = runScript('scripts/credentials/check-local-release-credentials.mjs', safeLocalReleaseEnv(mockBin, {
            AWS_MOCK_MODE: 'missing-creds',
        }));

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/AWS STS identity check failed/);
        expect(result.output).not.toMatch(/123456789012/);
    });

    test('local release credential checker accepts the explicit staging role profile shape', () => {
        const mockBin = writeMockAwsCli();
        const result = runScript('scripts/credentials/check-local-release-credentials.mjs', safeLocalReleaseEnv(mockBin, {
            AWS_MOCK_PROFILE_MODE: 'staging-role',
            STAGING_AWS_DEPLOY_ROLE_ARN: 'arn:aws:iam::123456789012:role/aura-staging-bootstrap-operator',
        }));

        expect(result.status).toBe(0);
        expect(result.output).toMatch(/local-release-credentials: passed/);
        expect(result.output).not.toMatch(/aura-admin-cli/);
        expect(result.output).not.toMatch(/123456789012/);
    });

    test('local release credential checker rejects direct static credentials on the operator profile', () => {
        const mockBin = writeMockAwsCli();
        const result = runScript('scripts/credentials/check-local-release-credentials.mjs', safeLocalReleaseEnv(mockBin, {
            AWS_MOCK_PROFILE_MODE: 'direct-static',
        }));

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/must not store AWS access keys/);
        expect(result.output).not.toMatch(/AKIA_TEST_DO_NOT_PRINT/);
        expect(result.output).not.toMatch(/test-placeholder-do-not-print-secret/);
    });

    test('local release credential checker rejects production role profiles', () => {
        const mockBin = writeMockAwsCli();
        const result = runScript('scripts/credentials/check-local-release-credentials.mjs', safeLocalReleaseEnv(mockBin, {
            AWS_MOCK_PROFILE_MODE: 'production-role',
        }));

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/must assume an explicit staging role/);
        expect(result.output).not.toMatch(/aura-admin-cli/);
        expect(result.output).not.toMatch(/123456789012/);
    });

    test('local release credential checker fails when staging env vars are missing', () => {
        const mockBin = writeMockAwsCli();
        const result = runScript('scripts/credentials/check-local-release-credentials.mjs', safeLocalReleaseEnv(mockBin, {
            STAGING_API_BASE_URL: '',
            STAGING_HEALTH_URL: '',
        }));

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/Missing required items/);
        expect(result.output).toMatch(/STAGING_API_BASE_URL is required/);
        expect(result.output).toMatch(/STAGING_HEALTH_URL is required/);
    });

    test('local release credential checker fails when a staging URL points to production', () => {
        const mockBin = writeMockAwsCli();
        const result = runScript('scripts/credentials/check-local-release-credentials.mjs', safeLocalReleaseEnv(mockBin, {
            STAGING_API_BASE_URL: 'https://prod.example.test',
        }));

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/STAGING_API_BASE_URL must not point to a production or production-like URL/);
        expect(result.output).not.toContain('https://prod.example.test');
    });

    test('local release credential checker passes with mocked safe AWS identity and staging env', () => {
        const mockBin = writeMockAwsCli();
        const result = runScript('scripts/credentials/check-local-release-credentials.mjs', safeLocalReleaseEnv(mockBin));

        expect(result.status).toBe(0);
        expect(result.output).toMatch(/local-release-credentials: passed/);
        expect(result.output).toMatch(/AWS STS identity: reachable/);
        expect(result.output).not.toMatch(/123456789012/);
    });

    test('local release credential checker never prints secret-like env values', () => {
        const mockBin = writeMockAwsCli();
        const secretCanary = 'test-placeholder-do-not-print-release-secret';
        const result = runScript('scripts/credentials/check-local-release-credentials.mjs', safeLocalReleaseEnv(mockBin, {
            STAGING_HEALTH_URL: '',
            AWS_SECRET_ACCESS_KEY: secretCanary,
            AUTH_CLIENT_SECRET: secretCanary,
        }));

        expect(result.status).not.toBe(0);
        expect(result.output).not.toContain(secretCanary);
        expect(result.output).not.toMatch(/AWS_SECRET_ACCESS_KEY/);
        expect(result.output).not.toMatch(/AUTH_CLIENT_SECRET/);
    });

    test('local release SSO profile setup fails closed when metadata is missing', () => {
        const mockBin = writeMockAwsCli();
        const result = runScript('scripts/credentials/setup-local-release-sso-profile.mjs', {
            [pathEnvName]: `${mockBin.dir}${path.delimiter}${process.env[pathEnvName] || process.env.PATH || ''}`,
            AWS_CLI_PATH: mockBin.command,
        });

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/local-release-sso-profile: failed/);
        expect(result.output).toMatch(/AURA_AWS_SSO_START_URL is required/);
    });

    test('local release SSO profile setup writes only non-secret SSO profile keys', () => {
        const mockBin = writeMockAwsCli();
        const result = runScript('scripts/credentials/setup-local-release-sso-profile.mjs', {
            [pathEnvName]: `${mockBin.dir}${path.delimiter}${process.env[pathEnvName] || process.env.PATH || ''}`,
            AWS_CLI_PATH: mockBin.command,
            AWS_REGION: 'ap-south-1',
            AURA_AWS_SSO_START_URL: 'https://example.awsapps.com/start',
            AURA_AWS_SSO_REGION: 'us-east-1',
            AURA_AWS_SSO_ACCOUNT_ID: '123456789012',
            AURA_AWS_SSO_ROLE_NAME: 'AuraStagingReleaseGateOperator',
        });

        expect(result.status).toBe(0);
        expect(result.output).toMatch(/local-release-sso-profile: configured/);
        expect(result.output).toMatch(/aura-staging-operator/);
        expect(result.output).not.toContain('example.awsapps.com');
        expect(result.output).not.toMatch(/123456789012/);
        expect(result.output).not.toMatch(/AuraStagingReleaseGateOperator/);
    });

    test('staging Keycloak auth smoke skips with an explicit reason when env is absent', () => {
        const envFile = writeTempEnvFile('');
        const result = runScript(
            'scripts/auth/smoke.mjs',
            blankAuthSmokeEnv,
            ['--environment', 'staging', '--env-file', envFile, '--require-provider', 'keycloak', '--skip-if-missing']
        );

        expect(result.status).toBe(0);
        expect(result.output).toMatch(/skip reason=missing Keycloak smoke env/);
        expect(result.output).toMatch(/AUTH_PROVIDER=keycloak/);
    });

    test('staging Keycloak auth smoke fails closed when required provider env is absent', () => {
        const envFile = writeTempEnvFile('');
        const result = runScript(
            'scripts/auth/smoke.mjs',
            blankAuthSmokeEnv,
            ['--environment', 'staging', '--env-file', envFile, '--require-provider', 'keycloak']
        );

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/AUTH_PROVIDER must be keycloak/);
    });

    test('staging Keycloak auth smoke accepts a strict configured contract before live mode', () => {
        const envFile = writeTempEnvFile([
            'AUTH_PROVIDER=keycloak',
            'AUTH_ISSUER_URL=https://auth.staging.aura.internal/realms/aura',
            'AUTH_CLIENT_ID=aura-web',
            'AUTH_CLIENT_TYPE=public',
            'AUTH_OIDC_STATE_SECRET=staging-state-secret-0123456789abcdef',
            'AUTH_AUDIENCE=aura-web',
            'AUTH_REDIRECT_URI=https://staging.aura.internal/auth/callback',
            'AUTH_POST_LOGOUT_REDIRECT_URI=https://staging.aura.internal/login',
            '',
        ].join('\n'));
        const result = runScript(
            'scripts/auth/smoke.mjs',
            blankAuthSmokeEnv,
            ['--environment', 'staging', '--strict', '--env-file', envFile, '--require-provider', 'keycloak']
        );

        expect(result.status).toBe(0);
        expect(result.output).toMatch(/provider=keycloak/);
        expect(result.output).toMatch(/mode=contract-only/);
    });

    test('staging smoke workflow wires a strict live Keycloak gate with optional explicit skip', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'staging-smoke.yml'), 'utf8');

        expect(workflow).toMatch(/STAGING_KEYCLOAK_SMOKE_REQUIRED/);
        expect(workflow).toMatch(/AUTH_ISSUER_URL/);
        expect(workflow).toMatch(/AUTH_CLIENT_SECRET/);
        expect(workflow).toMatch(/scripts\/auth\/smoke\.mjs/);
        expect(workflow).toMatch(/--no-env-file/);
        expect(workflow).toMatch(/--live/);
        expect(workflow).toMatch(/--strict/);
        expect(workflow).toMatch(/--require-provider keycloak/);
        expect(workflow).toMatch(/--skip-if-missing/);
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

    test('backend staging route smoke only requires scanner readiness when explicitly configured', async () => {
        const server = http.createServer((request, response) => {
            const url = request.url || '';
            if (url === '/health') {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({
                    env: 'staging',
                    ssmPrefix: '/aura/staging',
                    database: 'staging',
                    cache: 'staging',
                    storage: 'staging',
                    scanner: 'not_ready',
                }));
                return;
            }
            if (url.startsWith('/api/health') || url.startsWith('/uploads/')) {
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ ok: false }));
                return;
            }
            if (url.startsWith('/socket.io/')) {
                response.writeHead(400, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ ok: false }));
                return;
            }
            response.writeHead(404);
            response.end('');
        });

        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        const target = `http://127.0.0.1:${port}`;

        try {
            const optionalResult = await runScriptAsync('scripts/smoke/staging-route-smoke.mjs', {
                STAGING_API_BASE_URL: target,
                STAGING_HEALTH_URL: `${target}/health`,
                PROD_BASE_URL: 'https://prod.example.test',
                PROD_API_BASE_URL: 'https://api.prod.example.test',
            });
            expect(optionalResult.status).toBe(0);
            expect(optionalResult.output).toMatch(/health scanner: not_ready \(not required\)/);

            const requiredResult = await runScriptAsync('scripts/smoke/staging-route-smoke.mjs', {
                STAGING_API_BASE_URL: target,
                STAGING_HEALTH_URL: `${target}/health`,
                PROD_BASE_URL: 'https://prod.example.test',
                PROD_API_BASE_URL: 'https://api.prod.example.test',
                SMOKE_REQUIRE_SCANNER_READY: 'true',
            });
            expect(requiredResult.status).not.toBe(0);
            expect(requiredResult.output).toMatch(/Health scanner must be ready; got not_ready/);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    test('frontend staging target script only requires scanner readiness when explicitly configured', async () => {
        const server = http.createServer((request, response) => {
            const url = request.url || '';
            if (url === '/' || url === '/health') {
                response.writeHead(200, { 'content-type': url === '/' ? 'text/html' : 'application/json' });
                response.end(url === '/'
                    ? '<!doctype html><html><head></head><body>staging</body></html>'
                    : JSON.stringify({
                        env: 'staging',
                        ssmPrefix: '/aura/staging',
                        database: 'staging',
                        cache: 'staging',
                        storage: 'staging',
                        scanner: 'not_ready',
                    }));
                return;
            }
            if (url.startsWith('/api/health') || url.startsWith('/uploads/')) {
                response.writeHead(404, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ ok: false }));
                return;
            }
            if (url.startsWith('/socket.io/')) {
                response.writeHead(400, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ ok: false }));
                return;
            }
            response.writeHead(404);
            response.end('');
        });

        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        const target = `http://127.0.0.1:${port}`;

        try {
            const optionalResult = await runScriptAsync('scripts/smoke/assert-frontend-staging-target.mjs', {
                STAGING_FRONTEND_URL: target,
                STAGING_API_BASE_URL: target,
                STAGING_HEALTH_URL: `${target}/health`,
                PROD_BASE_URL: 'https://prod.example.test',
                PROD_API_BASE_URL: 'https://api.prod.example.test',
            });
            expect(optionalResult.status).toBe(0);
            expect(optionalResult.output).toMatch(/scanner: not_ready \(not required\)/);

            const requiredResult = await runScriptAsync('scripts/smoke/assert-frontend-staging-target.mjs', {
                STAGING_FRONTEND_URL: target,
                STAGING_API_BASE_URL: target,
                STAGING_HEALTH_URL: `${target}/health`,
                PROD_BASE_URL: 'https://prod.example.test',
                PROD_API_BASE_URL: 'https://api.prod.example.test',
                SMOKE_REQUIRE_SCANNER_READY: 'true',
            });
            expect(requiredResult.status).not.toBe(0);
            expect(requiredResult.output).toMatch(/scanner must be ready; got not_ready/);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
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
        expect(deployScript).not.toMatch(/vercel-staging-autopilot/);

        const commonScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', 'lib', 'common.sh'), 'utf8');
        expect(commonScript).toMatch(/nginx_staging_server_name/);
        expect(commonScript).toMatch(/Could not derive concrete Nginx server_name/);
        expect(commonScript).toMatch(/ec2PublicDns/);

        const composeScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '07-deploy-compose.sh'), 'utf8');
        expect(composeScript).toMatch(/nginx_staging_server_name "\$staging_api_url"/);
        expect(composeScript).toMatch(/MONGO_REQUIRE_TLS=false/);
        expect(composeScript).toMatch(/ssm_get_optional\(\)/);
        expect(composeScript).toMatch(/append_env_if_set DUO_ENABLED "\$duo_enabled"/);
        expect(composeScript).toMatch(/append_env_if_set DUO_CLIENT_SECRET "\$duo_client_secret"/);
        expect(composeScript).toMatch(/append_env_if_set DUO_DISCOVERY_URL "\$duo_discovery_url"/);

        const frontendDockerScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '12-deploy-frontend-docker.sh'), 'utf8');
        expect(frontendDockerScript).toMatch(/nginx_staging_server_name "\$frontend_url"/);
        expect(frontendDockerScript).toMatch(/curl -fsS .*2>\/dev\/null/);
        const sanitizerIndex = frontendDockerScript.indexOf('wss:\\/\\/dbtrhsolhec1s\\.cloudfront\\.net');
        const guardIndex = frontendDockerScript.indexOf('Refusing to deploy staging frontend with production signals');
        expect(sanitizerIndex).toBeGreaterThan(-1);
        expect(sanitizerIndex).toBeLessThan(guardIndex);
    });

    test('staging IAM operator grants only the Cost Explorer read used by cost watch', () => {
        const iamScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '00-create-iam-auth.sh'), 'utf8');
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'staging-ops-watch.yml'), 'utf8');

        expect(iamScript).toMatch(/ReadStagingCostExplorerUsage/);
        expect(iamScript).toMatch(/"ce:GetCostAndUsage"/);
        expect(iamScript).not.toMatch(/ce:\*/);
        expect(iamScript).toMatch(/ce:GetCostForecast/);
        expect(workflow).toMatch(/ALLOW_NO_COST_WATCH:\s*\$\{\{\s*vars\.ALLOW_NO_COST_WATCH \|\| 'true'\s*\}\}/);
    });

    test('Vercel staging autopilot stops before Preview deploy when env writes fail', () => {
        const autopilot = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', 'vercel-staging-autopilot.mjs'), 'utf8');

        expect(autopilot).toMatch(/Preview branch staging requires successful branch-scoped Vercel env writes/);
        expect(autopilot).toMatch(/stopping before deploying a Preview URL/);
        expect(autopilot).not.toMatch(/deployment still uses explicit build env/);
    });

    test('staging AWS deploy workflow is manual and explicitly gated', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'staging-aws-deploy.yml'), 'utf8');

        expect(workflow).toMatch(/workflow_dispatch/);
        expect(workflow).toMatch(/environment: staging/);
        expect(workflow).toMatch(/deploy_enabled/);
        expect(workflow).toMatch(/STAGING_DEPLOY_ENABLED/);
        expect(workflow).toMatch(/STAGING_SSM_PREFIX.*\/aura\/staging/);
        expect(workflow).toMatch(/PROD_SSM_PREFIX.*\/aura\/prod/);
        expect(workflow).toMatch(/SMOKE_BASE_URL:\s*\$\{\{\s*vars\.STAGING_BASE_URL\s*\}\}/);
        expect(workflow).toMatch(/SMOKE_REQUIRE_SCANNER_READY/);
    });

    test('production-on-push requires manual confirmation before production dispatch', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'production-on-push.yml'), 'utf8');
        const manualGate = "if: github.event_name == 'workflow_dispatch' && inputs.confirm_production == 'PRODUCTION'";
        const jobSection = (jobName) => {
            const match = workflow.match(new RegExp(`\\n  ${jobName}:\\n[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:\\n|$)`));
            expect(match).toBeTruthy();
            return match[0];
        };

        expect(workflow).toMatch(/push:\s*\n\s*branches: \["main"\]/);
        expect(workflow).toMatch(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*confirm_production:/);
        expect(workflow).toContain('--workflow staging-ops-watch.yml');
        expect(workflow).toContain('Production dispatch confirmation');

        for (const [jobName, dispatchedWorkflow] of [
            ['deploy-backend', 'deploy-backend-aws.yml'],
            ['deploy-storefront', 'deploy-netlify.yml'],
            ['deploy-gateway', 'deploy-gateway-vercel.yml'],
            ['release-desktop', 'desktop-release.yml'],
            ['release-mobile', 'mobile-release.yml'],
        ]) {
            const section = jobSection(jobName);
            expect(section).toContain(manualGate);
            expect(section).toContain(`--workflow ${dispatchedWorkflow}`);
        }
    });

    test('manual production command center stays within GitHub workflow_dispatch input limit', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'production-cicd.yml'), 'utf8');
        const inputsBlock = workflow.match(/workflow_dispatch:\s*\r?\n\s*inputs:\s*\r?\n([\s\S]*?)\r?\npermissions:/);
        expect(inputsBlock).toBeTruthy();

        const inputNames = [...inputsBlock[1].matchAll(/^ {6}([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]);

        expect(inputNames.length).toBeLessThanOrEqual(10);
        expect(inputNames).toEqual(expect.arrayContaining([
            'confirm_production',
            'deploy_targets',
            'release_targets',
            'rollback_targets',
        ]));
        expect(inputNames).not.toContain('deploy_backend');
        expect(inputNames).not.toContain('rollback_backend');
        expect(inputNames).not.toContain('release_desktop');
    });

    test('manual production command center does not under-grant CI reusable workflow permissions', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'production-cicd.yml'), 'utf8');
        const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
        const qualityGates = workflow.match(/\n  quality-gates:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:\n|$)/);
        expect(qualityGates).toBeTruthy();

        expect(ciWorkflow).toContain('workflow_call:');
        expect(ciWorkflow).toContain('pull-requests: read');
        expect(qualityGates[0]).toContain('uses: ./.github/workflows/ci.yml');
        expect(qualityGates[0]).toContain('contents: read');
        expect(qualityGates[0]).toContain('pull-requests: read');
    });

    test('production admin recovery keeps direct /aura/prod Parameter Store writes available', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'production-admin-access.yml'), 'utf8');
        const bootstrap = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'bootstrap-github-oidc.ps1'), 'utf8');

        expect(workflow).toMatch(/test "\$\{AWS_PARAMETER_STORE_PATH_PREFIX\}" = "\/aura\/prod"/);
        expect(workflow).toContain('--name "${AWS_PARAMETER_STORE_PATH_PREFIX}/ADMIN_ALLOWLIST_EMAILS"');
        expect(workflow).toContain('--type SecureString');
        expect(workflow).toContain('--value "${ADMIN_ALLOWLIST_EMAILS}"');
        expect(workflow).toContain('--name "${AWS_PARAMETER_STORE_PATH_PREFIX}/ADMIN_REQUIRE_ALLOWLIST"');
        expect(workflow).toContain('--type String');
        expect(workflow).toContain('--value "true"');
        expect(workflow).toContain('parameter_store_updated=true');

        expect(bootstrap).toMatch(/\[string\]\$ParameterStorePathPrefix = "\/aura\/prod"/);
        expect(bootstrap).toContain('RuntimeParameterUpdates');
        expect(bootstrap).toContain('"ssm:PutParameter"');
        expect(bootstrap).toContain('parameter$normalizedParameterStorePathPrefix');
        expect(bootstrap).toContain('parameter$normalizedParameterStorePathPrefix/*');
        expect(bootstrap).not.toContain('arn:aws:ssm:${AwsRegion}:*:parameter');
    });

    test('production admin recovery falls back through SSM runtime update when PutParameter is denied', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'production-admin-access.yml'), 'utf8');
        const doctor = fs.readFileSync(path.join(repoRoot, 'scripts', 'ci-cd-doctor.mjs'), 'utf8');

        expect(workflow).toContain('AccessDeniedException');
        expect(workflow).toContain('parameter_store_updated=false');
        expect(workflow).toContain('Apply direct runtime admin allowlist fallback');
        expect(workflow).toMatch(/if: steps\.write_policy\.outputs\.parameter_store_updated != 'true'/);
        expect(workflow).toContain('AWS-RunShellScript');
        expect(workflow).toContain('/opt/aura/shared/runtime-secrets.env');
        expect(workflow).toContain('grep -v -E "^(ADMIN_ALLOWLIST_EMAILS|ADMIN_REQUIRE_ALLOWLIST)="');
        expect(workflow).toContain('ADMIN_REQUIRE_ALLOWLIST=true');
        expect(workflow).toContain('${COMPOSE_PREFIX} up -d --force-recreate api');
        expect(workflow).toContain('http://127.0.0.1:5000/health');

        expect(doctor).toContain('production admin access has runtime fallback');
        expect(doctor).toContain('backend deploy OIDC policy can update runtime parameters');
        expect(doctor).toContain('RuntimeParameterUpdates');
        expect(doctor).toContain('"ssm:PutParameter"');
    });

    test('AWS backend bootstrap and deploy scripts keep hardening guardrails', () => {
        const bootstrap = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'bootstrap-free-tier.ps1'), 'utf8');
        const oidcBootstrap = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'bootstrap-github-oidc.ps1'), 'utf8');
        const securityPostureBootstrap = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'bootstrap-security-posture.ps1'), 'utf8');
        const renderRuntimeSecrets = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'render-runtime-secrets.sh'), 'utf8');
        const deployRelease = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'deploy-release.sh'), 'utf8');
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'deploy-backend-aws.yml'), 'utf8');

        expect(bootstrap).toContain('aws sts get-caller-identity');
        expect(bootstrap).toContain('put-bucket-versioning');
        expect(bootstrap).toContain('NoncurrentVersionExpiration');
        expect(bootstrap).toContain('""Encrypted"":true');
        expect(bootstrap).toContain('Set-Alias -Name aws -Value Invoke-AwsChecked -Scope Script');
        expect(bootstrap).not.toContain('arn:aws:ssm:${Region}:*:parameter');
        expect(bootstrap).toContain('parameter$normalizedParameterPrefix');
        expect(bootstrap).toContain('parameter$normalizedParameterPrefix/*');

        expect(oidcBootstrap).not.toContain('arn:aws:ssm:${AwsRegion}:*:parameter');
        expect(oidcBootstrap).toContain('Set-Alias -Name aws -Value Invoke-AwsChecked -Scope Script');
        expect(oidcBootstrap).toContain('parameter$normalizedParameterStorePathPrefix');
        expect(oidcBootstrap).toContain('parameter$normalizedParameterStorePathPrefix/*');

        expect(securityPostureBootstrap).toContain('guardduty create-detector');
        expect(securityPostureBootstrap).toContain('Set-Alias -Name aws -Value Invoke-AwsChecked -Scope Script');
        expect(securityPostureBootstrap).toContain('GuardDuty: blocked - account subscription required');
        expect(securityPostureBootstrap).toContain('configservice put-configuration-recorder');
        expect(securityPostureBootstrap).toContain('configservice start-configuration-recorder');
        expect(securityPostureBootstrap).toContain('ec2 create-flow-logs');
        expect(securityPostureBootstrap).toContain('logs put-retention-policy');
        expect(securityPostureBootstrap).toContain('BucketOwnerEnforced');

        expect(renderRuntimeSecrets).toContain('invalid_parameter_names');
        expect(renderRuntimeSecrets).toContain('^[A-Za-z_][A-Za-z0-9_]*$');

        expect(deployRelease).toContain('AURA_INFRA_BUNDLE_SHA256');
        expect(deployRelease).toContain('AURA_IMAGE_BUNDLE_SHA256');
        expect(deployRelease).toContain('verify_sha256 "${release_dir}/infra.tar.gz"');
        expect(deployRelease).toContain('verify_sha256 "${release_dir}/image.tar.gz"');
        expect(deployRelease).toContain('upsert_env_value "${shared_dir}/base.env" "AUTH_SESSION_ALLOW_MEMORY_FALLBACK" "false"');
        expect(deployRelease).toContain('upsert_env_value "${shared_dir}/base.env" "AUTH_WEBAUTHN_RP_ID" "aurapilot.vercel.app"');
        expect(deployRelease).toContain('upsert_env_value "${shared_dir}/base.env" "AUTH_WEBAUTHN_ORIGIN" "https://aurapilot.vercel.app"');
        expect(deployRelease).toContain('upsert_env_value "${shared_dir}/base.env" "AUTH_WEBAUTHN_USER_VERIFICATION" "required"');

        expect(workflow).toContain('sha256sum "${RUNNER_TEMP}/aura-infra-${GITHUB_SHA}.tar.gz"');
        expect(workflow).toContain('sha256sum "${RUNNER_TEMP}/aura-image-${GITHUB_SHA}.tar.gz"');
        expect(workflow).toContain('sha256sum --check --status');
        expect(workflow).toContain('AURA_INFRA_BUNDLE_SHA256');
        expect(workflow).toContain('AURA_IMAGE_BUNDLE_SHA256');
    });

    test('performance smoke fails when no real target is reachable', () => {
        const result = runScript('scripts/performance/smoke.mjs', {
            PERF_BASE_URL: 'http://127.0.0.1:65534',
            PERF_API_BASE_URL: 'http://127.0.0.1:65534',
            PERF_SMOKE_TIMEOUT_MS: '150',
        });

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/No performance target was reachable/);
    });

    test('performance smoke workflow starts local targets when no target vars are configured', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'performance-smoke.yml'), 'utf8');

        expect(workflow).toMatch(/Build local frontend performance target/);
        expect(workflow).toMatch(/Start local performance targets/);
        expect(workflow).toContain("docker compose up -d --build mongo redis aura-api");
        expect(workflow).toContain("npm --prefix app run preview -- --host 0.0.0.0 --port 3000");
        expect(workflow).toContain("http://127.0.0.1:5000/health");
        expect(workflow).toContain("http://127.0.0.1:3000/");
        expect(workflow).toMatch(/Lighthouse if configured URL available/);
        expect(workflow).toMatch(/if: \$\{\{ \(vars\.PERF_BASE_URL \|\| ''\) != '' \}\}/);
        expect(workflow).toMatch(/Stop local performance targets/);
        expect(workflow).toContain("docker compose down -v --remove-orphans");
    });

    test('performance smoke passes after touching a local target', async () => {
        const server = http.createServer((request, response) => {
            const url = request.url || '';
            if (
                url === '/' ||
                url === '/health' ||
                url === '/api/status/public' ||
                url.startsWith('/api/products')
            ) {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ ok: true }));
                return;
            }

            response.writeHead(404, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'not_found' }));
        });

        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        const target = `http://127.0.0.1:${port}`;

        try {
            const result = await runScriptAsync('scripts/performance/smoke.mjs', {
                PERF_BASE_URL: target,
                PERF_API_BASE_URL: target,
                PERF_SMOKE_TIMEOUT_MS: '1000',
            });

            expect(result.status).toBe(0);
            expect(result.output).toMatch(/frontend ok/);
            expect(result.output).toMatch(/health ok/);
            expect(result.output).toMatch(/Performance smoke completed/);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    test('giant release gates are wired to package scripts and fail-closed scripts', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

        expect(pkg.scripts['staging:state:check']).toContain('refresh-state-from-aws.mjs --check');
        expect(pkg.scripts['staging:state:refresh']).toContain('refresh-state-from-aws.mjs');
        expect(pkg.scripts['smoke:env-contract']).toContain('assert-environment-contract.mjs');
        expect(pkg.scripts['aws:cost-guard']).toContain('assert-free-tier-cost-guard.mjs');
        expect(pkg.scripts['aws:observability:guard']).toContain('assert-observability-guard.mjs');
        expect(pkg.scripts['release:rollback-ready']).toContain('assert-rollback-ready.mjs');
        expect(pkg.scripts['release:production-mutation-gate']).toContain('assert-production-mutation-gate.mjs');

        const stateRefresh = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', 'refresh-state-from-aws.mjs'), 'utf8');
        expect(stateRefresh).toContain('Name=tag:Environment,Values=staging');
        expect(stateRefresh).toContain('expectedManagedBy');
        expect(stateRefresh).toContain('more than one');
        expect(stateRefresh).toContain('writeJsonAtomic(stateFile, nextState)');
        expect(stateRefresh).not.toContain('Environment=production');

        const iamBootstrap = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '00-create-iam-auth.sh'), 'utf8');
        expect(iamBootstrap).toContain('sts:AssumeRoleWithWebIdentity');
        expect(iamBootstrap).toContain('token.actions.githubusercontent.com:sub');
        expect(iamBootstrap).toContain('repo:$github_repo:environment:staging');

        const productionGate = fs.readFileSync(path.join(repoRoot, 'scripts', 'release', 'assert-production-mutation-gate.mjs'), 'utf8');
        expect(productionGate).toContain("gitBranch() !== 'main'");
        expect(productionGate).toContain('AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED');
        expect(productionGate).toContain('PRODUCTION_MUTATION_CONFIRMATION');
        expect(productionGate).toContain('staging-smoke');
        expect(productionGate).toContain('cost-guard');

        const costGuard = fs.readFileSync(path.join(repoRoot, 'scripts', 'aws', 'assert-free-tier-cost-guard.mjs'), 'utf8');
        const observabilityGuard = fs.readFileSync(path.join(repoRoot, 'scripts', 'aws', 'assert-observability-guard.mjs'), 'utf8');
        const branchProtectionGuard = fs.readFileSync(path.join(repoRoot, 'scripts', 'github', 'assert-main-protection.mjs'), 'utf8');
        expect(costGuard).toContain("emitEvidence('blocked')");
        expect(observabilityGuard).toContain("emitEvidence('blocked')");
        expect(branchProtectionGuard).toContain("'aws:observability:guard'");
        expect(branchProtectionGuard).toContain('dismiss_stale_reviews');
        expect(branchProtectionGuard).toContain('required_status_checks?.strict');
    });

    test('giant release workflow runs read-only gates and no production mutation gate', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'giant-release-gates.yml'), 'utf8');

        expect(workflow).toMatch(/pull_request:/);
        expect(workflow).toMatch(/branches: \[main\]/);
        expect(workflow).toContain('name: smoke:staging');
        expect(workflow).toContain('name: smoke:staging:frontend');
        expect(workflow).toContain('name: smoke:env-contract');
        expect(workflow).toContain('name: aws:cost-guard');
        expect(workflow).toContain('name: aws:observability:guard');
        expect(workflow).toContain('name: release:rollback-ready');
        expect(workflow).toContain('ROLLBACK_TARGET_SHA: ${{ vars.ROLLBACK_TARGET_SHA }}');
        expect(workflow).not.toContain('github.event.pull_request.base.sha');
        expect(workflow).toContain('npm run staging:state:refresh');
        expect(workflow).toContain('npm run aws:observability:guard');
        expect(workflow).not.toContain('release:production-mutation-gate');
        expect(workflow).not.toContain('AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED: true');
    });

    test('free-tier AWS guard config blocks expensive services by default', () => {
        const guard = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'aws-free-guard.json'), 'utf8'));

        expect(guard.region).toBe('ap-south-1');
        expect(guard.maxMonthlyUsd).toBeLessThanOrEqual(5);
        expect(guard.allowNatGateway).toBe(false);
        expect(guard.allowLoadBalancer).toBe(false);
        expect(guard.allowPaidRds).toBe(false);
        expect(guard.allowPaidElasticache).toBe(false);
        expect(guard.allowOpenSearch).toBe(false);
        expect(guard.requiredSsmPrefixes).toEqual(expect.arrayContaining(['/aura/staging', '/aura/prod']));
    });
});
