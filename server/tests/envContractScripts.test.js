const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const yaml = require('js-yaml');
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

const extractBashFunction = (source, name) => {
    const lines = source.split(/\r?\n/);
    const start = lines.findIndex((line) => line === `${name}() {`);
    if (start < 0) throw new Error(`Missing Bash function: ${name}`);
    const endOffset = lines.slice(start + 1).findIndex((line) => line === '}');
    if (endOffset < 0) throw new Error(`Unterminated Bash function: ${name}`);
    return lines.slice(start, start + endOffset + 2).join('\n');
};

const runComposeProfileSanitizer = (source, input) => {
    const bash = process.platform === 'win32'
        ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
        : 'bash';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-compose-profiles-'));
    const script = path.join(dir, 'sanitize.sh');
    const functions = [
        'trim',
        'strip_inline_comment',
        'normalize_env_value',
        'to_lower',
        'sanitize_compose_profiles',
    ].map((name) => extractBashFunction(source, name));
    fs.writeFileSync(script, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        ...functions,
        'sanitize_compose_profiles "$1"',
        '',
    ].join('\n'));

    try {
        const output = execFileSync(bash, [script, input], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { status: 0, output };
    } catch (error) {
        return {
            status: error.status || 1,
            output: `${error.stdout || ''}${error.stderr || ''}`,
        };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const runReleaseLockProbe = (source, mode) => {
    const bash = process.platform === 'win32'
        ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
        : 'bash';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-release-lock-'));
    const script = path.join(dir, 'lock.sh');
    const lockFile = path.join(dir, 'backend-release.lock');
    const traceFile = path.join(dir, 'flock.trace');
    const functions = [
        'acquire_release_lock',
        'release_release_lock',
    ].map((name) => extractBashFunction(source, name));
    fs.writeFileSync(script, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'flock() {',
        '  printf \'%s\\n\' "$*" >> "${AURA_FLOCK_TRACE}"',
        '  if [[ "$1" == "--exclusive" && "${AURA_TEST_FLOCK_MODE}" == "contended" ]]; then',
        '    return 1',
        '  fi',
        '}',
        'release_lock_acquired=false',
        ...functions,
        'trap release_release_lock EXIT',
        'acquire_release_lock "$1"',
        'printf \'critical-section\\n\'',
        '',
    ].join('\n'));

    try {
        const output = execFileSync(bash, [script, lockFile], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: {
                ...process.env,
                AURA_FLOCK_TRACE: traceFile,
                AURA_TEST_FLOCK_MODE: mode,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return {
            status: 0,
            output,
            trace: fs.readFileSync(traceFile, 'utf8'),
        };
    } catch (error) {
        return {
            status: error.status || 1,
            output: `${error.stdout || ''}${error.stderr || ''}`,
            trace: fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8') : '',
        };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const runActivationRestoreProbe = (source) => {
    const bash = process.platform === 'win32'
        ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
        : 'bash';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-activation-restore-'));
    const script = path.join(dir, 'restore.sh');
    const traceFile = path.join(dir, 'docker.trace');
    const restoreFunction = extractBashFunction(source, 'restore_previous_release');
    const upsertFunction = extractBashFunction(source, 'upsert_env_value');

    fs.writeFileSync(script, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'docker() { printf \'%s\\n\' "$*" >> "${AURA_DOCKER_TRACE}"; }',
        'curl() { return 0; }',
        'assert_no_model_compose_contract() { return 0; }',
        'resolve_runtime_contract_value() { printf \'restore-health-token\'; }',
        'resolve_env_value() {',
        '  if [[ "$1" == "HEALTH_READY_TOKEN" ]]; then printf \'restore-health-token\'; else printf \'api.example.test\'; fi',
        '}',
        upsertFunction,
        restoreFunction,
        'current_dir="${AURA_TEST_ROOT}/current"',
        'shared_dir="${AURA_TEST_ROOT}/shared"',
        'base_env="${shared_dir}/base.env"',
        'runtime_env="${shared_dir}/runtime-secrets.env"',
        'release_env="${shared_dir}/release.env"',
        'activation_backup_dir="${AURA_TEST_ROOT}/current.previous"',
        'activation_backup_env="${AURA_TEST_ROOT}/release.env.previous"',
        'activation_backup_base_env="${AURA_TEST_ROOT}/base.env.previous"',
        'activation_backup_runtime_env="${AURA_TEST_ROOT}/runtime-secrets.env.previous"',
        'compose_profiles=""',
        'previous_current_present=true',
        'previous_release_env_present=true',
        'previous_base_env_present=true',
        'previous_runtime_env_present=true',
        'mkdir -p "${current_dir}/infra/aws" "${activation_backup_dir}/infra/aws" "${shared_dir}"',
        'printf \'new\\n\' > "${current_dir}/new-release-marker"',
        'printf \'old\\n\' > "${activation_backup_dir}/old-release-marker"',
        'printf \'services: {}\\n\' > "${current_dir}/infra/aws/docker-compose.ec2.yml"',
        'printf \'services: {}\\n\' > "${activation_backup_dir}/infra/aws/docker-compose.ec2.yml"',
        'printf \'BASE=true\\n\' > "${base_env}"',
        'printf \'RUNTIME=true\\n\' > "${runtime_env}"',
        'printf \'BASE=old\\nAI_MODEL_PROVIDER=ollama\\n\' > "${activation_backup_base_env}"',
        'printf \'RUNTIME=old\\n\' > "${activation_backup_runtime_env}"',
        'printf \'AURA_APP_BUILD_SHA=new\\n\' > "${release_env}"',
        'printf \'AURA_APP_BUILD_SHA=old\\nAI_MODEL_PROVIDER=ollama\\nCOMPOSE_PROFILES=ollama\\n\' > "${activation_backup_env}"',
        'restore_previous_release',
        'test -f "${current_dir}/old-release-marker"',
        'test ! -e "${current_dir}/new-release-marker"',
        'grep -q \'^AURA_APP_BUILD_SHA=old$\' "${release_env}"',
        'grep -q \'^AI_MODEL_PROVIDER=disabled$\' "${release_env}"',
        'grep -q \'^AI_MODEL_PROVIDER_FALLBACKS=$\' "${release_env}"',
        'grep -q \'^COMPOSE_PROFILES=$\' "${release_env}"',
        '',
    ].join('\n'));

    try {
        const output = execFileSync(bash, [script], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: {
                ...process.env,
                AURA_TEST_ROOT: dir,
                AURA_DOCKER_TRACE: traceFile,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return {
            status: 0,
            output,
            trace: fs.readFileSync(traceFile, 'utf8'),
        };
    } catch (error) {
        return {
            status: error.status || 1,
            output: `${error.stdout || ''}${error.stderr || ''}`,
            trace: fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8') : '',
        };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
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

    test('staging upload proxy preserves large backend security headers', () => {
        const template = fs.readFileSync(path.join(repoRoot, 'infra', 'staging', 'nginx-frontend.conf.template'), 'utf8');
        const uploadsLocation = template.match(/location \/uploads\/ \{[\s\S]*?\n    \}/);

        expect(uploadsLocation).toBeTruthy();
        expect(uploadsLocation[0]).toContain('proxy_buffer_size 32k;');
        expect(uploadsLocation[0]).toContain('proxy_buffers 8 32k;');
        expect(uploadsLocation[0]).toContain('proxy_busy_buffers_size 64k;');
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
            '11b-bootstrap-cloudfront-edge.sh',
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
        expect(httpsScript).toMatch(/STAGING_HTTPS_MODE/);
        expect(httpsScript).toMatch(/cloudfront get-distribution/);

        const cloudFrontBootstrap = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '11b-bootstrap-cloudfront-edge.sh'), 'utf8');
        expect(cloudFrontBootstrap).toContain('Aura isolated staging HTTPS edge');
        expect(cloudFrontBootstrap).toContain('AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET');
        expect(cloudFrontBootstrap).toContain('X-Aura-Origin-Verify');
        expect(cloudFrontBootstrap).toContain('CloudFrontDefaultCertificate');
        expect(cloudFrontBootstrap).toContain('OriginProtocolPolicy');
        expect(cloudFrontBootstrap).toContain('https-only');
        expect(cloudFrontBootstrap).toContain('redirect-to-https');
        expect(cloudFrontBootstrap).toContain('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
        expect(cloudFrontBootstrap).toContain('b689b0a8-53d0-40ab-baf2-68738e2966ac');
        expect(cloudFrontBootstrap).toContain('Key=Environment,Value=staging');
        expect(cloudFrontBootstrap).toContain('Key=ManagedBy,Value=codex-staging-bootstrap');
        expect(cloudFrontBootstrap).not.toContain('E34Z9POGIQYOCS');
        expect(cloudFrontBootstrap).not.toContain('dbtrhsolhec1s.cloudfront.net');

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
        expect(commonScript).toMatch(/required_verify_env_vars\(\)/);
        const verifyEnvSection = commonScript.match(/required_verify_env_vars\(\) \{[\s\S]*?\n\}/)?.[0] || '';
        expect(verifyEnvSection).toContain('STAGING_ALLOWED_SSH_CIDR');
        expect(verifyEnvSection).not.toContain('STAGING_BUDGET_EMAIL');

        const verifyScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '10-verify-staging.sh'), 'utf8');
        expect(verifyScript).toMatch(/STAGING_PREFLIGHT_MODE=verify bash "\$SCRIPT_DIR\/00-preflight\.sh"/);
        expect(verifyScript).toMatch(/17-diagnose-scanner\.sh/);

        const scannerDiagnostic = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '17-diagnose-scanner.sh'), 'utf8');
        expect(scannerDiagnostic).toMatch(/docker compose logs --tail=80 scanner/);
        expect(scannerDiagnostic).toMatch(/backend-to-scanner PING/);

        const composeScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '07-deploy-compose.sh'), 'utf8');
        expect(composeScript).toMatch(/nginx_staging_server_name "\$staging_api_url"/);
        expect(composeScript).toMatch(/MONGO_REQUIRE_TLS=false/);
        expect(composeScript).toMatch(/^admin_require_passkey=false$/m);
        expect(composeScript).toMatch(/^ADMIN_REQUIRE_PASSKEY=\$admin_require_passkey$/m);
        expect(composeScript).toMatch(/ssm_get_optional\(\)/);
        expect(composeScript).toMatch(/append_env_if_set DUO_ENABLED "\$duo_enabled"/);
        expect(composeScript).toMatch(/append_env_if_set DUO_CLIENT_SECRET "\$duo_client_secret"/);
        expect(composeScript).toMatch(/append_env_if_set DUO_DISCOVERY_URL "\$duo_discovery_url"/);
        expect(composeScript).toMatch(/append_env_if_set AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET "\$cloudfront_origin_verify_secret"/);

        const ssmScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '03-put-ssm-params.sh'), 'utf8');
        expect(ssmScript).toMatch(/^\s+put_string ADMIN_REQUIRE_PASSKEY false$/m);
        expect(ssmScript).toMatch(/if staging_admin_security_enabled; then/);

        const frontendDockerScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '12-deploy-frontend-docker.sh'), 'utf8');
        expect(frontendDockerScript).toMatch(/nginx_staging_server_name "\$frontend_url"/);
        expect(frontendDockerScript).toMatch(/curl -fsS .*2>\/dev\/null/);
        const sanitizerIndex = frontendDockerScript.indexOf('wss:\\/\\/dbtrhsolhec1s\\.cloudfront\\.net');
        const guardIndex = frontendDockerScript.indexOf('Refusing to deploy staging frontend with production signals');
        expect(sanitizerIndex).toBeGreaterThan(-1);
        expect(sanitizerIndex).toBeLessThan(guardIndex);
    });

    test('staging admin security qualification is opt-in and fail-closed', () => {
        const commonScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', 'lib', 'common.sh'), 'utf8');
        const preflightScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '00-preflight.sh'), 'utf8');
        const adminParamsScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '03b-put-admin-security-ssm-params.sh'), 'utf8');
        const composeScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '07-deploy-compose.sh'), 'utf8');
        const frontendScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '12-deploy-frontend-docker.sh'), 'utf8');
        const deployScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '16-deploy-all.sh'), 'utf8');
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'staging-aws-deploy.yml'), 'utf8');

        expect(commonScript).toContain('STAGING_ADMIN_SECURITY_PHASE:=legacy');
        expect(commonScript).toMatch(/legacy\|baseline\|backend\|frontend/);
        expect(commonScript).toContain('validate_staging_admin_security_phase');
        expect(commonScript).toContain('ENABLE_STAGING_HTTPS=true is required');
        expect(commonScript).toContain('STAGING_ADMIN_ALLOWLIST_EMAILS');
        expect(preflightScript).toContain('validate_staging_admin_security_phase');

        [
            'ADMIN_SECURITY_HASH_SECRET',
            'ADMIN_SECURITY_STATE_ENGINE_V2',
            'ADMIN_PASSKEY_ENROLLMENT',
            'ADMIN_PASSKEY_CHALLENGE',
            'ADMIN_RECOVERY_GRANTS',
            'ADMIN_ASSURANCE_ENFORCEMENT',
            'ADMIN_ACTION_BOUND_ASSURANCE',
            'ADMIN_RECOVERY_TWO_PERSON_REQUIRED',
            'AUTH_SESSION_ALLOW_MEMORY_FALLBACK',
            'AUTH_DEVICE_CHALLENGE_SECRET',
            'AUTH_WEBAUTHN_RP_ID',
            'AUTH_WEBAUTHN_ORIGIN',
            'AUTH_WEBAUTHN_USER_VERIFICATION',
            'MFA_ENABLED',
            'MFA_PASSKEY_ENABLED',
        ].forEach((name) => expect(adminParamsScript).toContain(name));
        expect(adminParamsScript).toMatch(/^put_secure_once ADMIN_SECURITY_HASH_SECRET /m);
        expect(adminParamsScript).not.toMatch(/^put_secure .*ADMIN_SECURITY_HASH_SECRET/m);
        expect(adminParamsScript).toMatch(/^put_secure ADMIN_ALLOWLIST_EMAILS /m);

        expect(composeScript).toContain('ADMIN_SECURITY_ROLLOUT_PHASE');
        expect(composeScript).toContain('ADMIN_SECURITY_HASH_SECRET');
        expect(composeScript).toContain('AUTH_SESSION_ALLOW_MEMORY_FALLBACK');
        expect(composeScript).toContain('DUO_FAIL_CLOSED');
        expect(frontendScript).toContain('VITE_ADMIN_SECURITY_STATE_ENGINE_V2');
        expect(deployScript).toContain('staging_admin_security_enabled');
        expect(deployScript).toContain('03b-put-admin-security-ssm-params.sh');
        expect(workflow).toContain('STAGING_ADMIN_SECURITY_PHASE');
        expect(workflow).toContain('STAGING_ADMIN_DUO_PROVIDER: ${{ vars.STAGING_ADMIN_DUO_PROVIDER }}');
        expect(workflow).toContain('STAGING_ADMIN_RECOVERY_TWO_PERSON_REQUIRED: ${{ vars.STAGING_ADMIN_RECOVERY_TWO_PERSON_REQUIRED }}');
        expect(workflow).toContain('Validate staging qualification contract without mutation');
        expect(workflow).toContain('STAGING_PREFLIGHT_DRY_RUN: "true"');
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
        expect(workflow).toMatch(/SMOKE_REQUIRE_SCANNER_READY:\s*"true"/);
        expect(workflow).toMatch(/cache-dependency-path:[\s\S]*?package-lock\.json[\s\S]*?app\/package-lock\.json/);
        expect(workflow).toMatch(/npm ci[\s\S]*?npm --prefix app ci/);
        expect(workflow).toMatch(/id:\s*lease-runner-ssh/);
        expect(workflow).toContain('https://checkip.amazonaws.com');
        expect(workflow).toMatch(/RUNNER_CIDR="\$\{RUNNER_IP\}\/32"/);
        expect(workflow).toMatch(/authorize-security-group-ingress[\s\S]*?--port 22[\s\S]*?--cidr "\$\{RUNNER_CIDR\}"/);
        expect(workflow).toMatch(/security_group_rule_id=\$\{SECURITY_GROUP_RULE_ID\}/);
        expect(workflow).toMatch(/runner_cidr=\$\{RUNNER_CIDR\}/);
        expect(workflow).toMatch(/STAGING_ALLOWED_SSH_CIDR:\s*\$\{\{\s*steps\.lease-runner-ssh\.outputs\.runner_cidr\s*\}\}/);
        expect(workflow).toMatch(/if:\s*\$\{\{ always\(\) && steps\.lease-runner-ssh\.outputs\.security_group_rule_id != '' \}\}/);
        expect(workflow).toMatch(/revoke-security-group-ingress[\s\S]*?--security-group-rule-ids "\$\{LEASED_SECURITY_GROUP_RULE_ID\}"/);

        const leaseIndex = workflow.indexOf('- name: Lease runner SSH access');
        const deployIndex = workflow.indexOf('- name: Deploy and verify isolated staging');
        const revokeIndex = workflow.indexOf('- name: Revoke runner SSH access');
        expect(leaseIndex).toBeGreaterThan(-1);
        expect(deployIndex).toBeGreaterThan(leaseIndex);
        expect(revokeIndex).toBeGreaterThan(deployIndex);
    });

    test('scheduled staging operations require malware scanner readiness', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'staging-ops-watch.yml'), 'utf8');

        expect(workflow).toMatch(/SMOKE_REQUIRE_SCANNER_READY:\s*"true"/);
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

    test('desktop release validates Firebase auth configuration before packaging', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'desktop-release.yml'), 'utf8');
        const preflight = workflow.match(/\n  release-preflight:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:\n|$)/);

        expect(preflight).toBeTruthy();
        expect(preflight[0]).toContain('Validate desktop Firebase auth configuration');
        expect(preflight[0]).toContain('node scripts/release/validate-desktop-firebase-config.mjs');
        expect(preflight[0]).not.toContain('continue-on-error: true');
    });

    test('desktop release defaults to fast Windows x64 while preserving full cross-platform mode', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'desktop-release.yml'), 'utf8');

        expect(workflow).toMatch(/release_mode:[\s\S]*?default:\s*fast/);
        expect(workflow).toContain("inputs.release_mode == 'full'");
        expect(workflow).toContain("'desktop:dist:win:all' || 'desktop:dist:win'");
        expect(workflow).toContain('macOS signing requires release_mode=full.');
    });

    test('desktop release builds Windows artifacts outside Git Bash path conversion', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'desktop-release.yml'), 'utf8');
        const windowsBuild = workflow.match(/- name: Build Windows desktop artifacts[\s\S]*?(?=\n\s+- name:)/);

        expect(windowsBuild).toBeTruthy();
        expect(windowsBuild[0]).toContain("if: matrix.platform == 'windows'");
        expect(windowsBuild[0]).toContain('shell: pwsh');
        expect(windowsBuild[0]).not.toContain('shell: bash');
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

    test('manual production command center rejects overlapping deploy and rollback lanes', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'production-cicd.yml'), 'utf8');

        expect(workflow).toContain('reject_overlapping_lane backend "${INPUT_DEPLOY_BACKEND}" "${INPUT_ROLLBACK_BACKEND}"');
        expect(workflow).toContain('reject_overlapping_lane frontend-multihost "${INPUT_DEPLOY_FRONTEND_NETLIFY}" "${INPUT_ROLLBACK_FRONTEND_NETLIFY}"');
        expect(workflow).toContain('reject_overlapping_lane gateway "${INPUT_DEPLOY_GATEWAY}" "${INPUT_ROLLBACK_GATEWAY}"');
    });

    test('manual production deploys require main and same-SHA release safety gates', () => {
        const production = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'production-cicd.yml'), 'utf8');
        const releaseGates = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'giant-release-gates.yml'), 'utf8');

        expect(production).toContain('Production actions must be dispatched from the main branch');
        expect(production).toContain('uses: ./.github/workflows/giant-release-gates.yml');
        expect(production).toContain("needs.release-safety-gates.result == 'success'");
        expect(production).toContain('STAGING_AWS_DEPLOY_ROLE_ARN: ${{ secrets.STAGING_AWS_DEPLOY_ROLE_ARN }}');
        expect(production).not.toContain('secrets: inherit');
        expect(releaseGates).toMatch(/workflow_call:\s*\n\s*secrets:/);
    });

    test('multi-host deploy rolls back every provider whose mutation was attempted', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'deploy-netlify.yml'), 'utf8');

        expect(workflow.match(/deployment_attempted: \$\{\{ steps\.mutation\.outputs\.attempted \}\}/g)).toHaveLength(3);
        expect(workflow).toContain("needs.deploy-production.outputs.deployment_attempted == 'true'");
        expect(workflow).toContain("needs.deploy-vercel-production.outputs.deployment_attempted == 'true'");
        expect(workflow).toContain("needs.deploy-aws-production.outputs.deployment_attempted == 'true'");
        expect(workflow).not.toContain("needs.deploy-production.outputs.deploy_url != ''");
        expect(workflow).not.toContain("needs.deploy-vercel-production.outputs.deploy_url != ''");
        expect(workflow).not.toContain("needs.deploy-aws-production.outputs.site_url != ''");
    });

    test('multi-host deploy captures exact rollback targets before mutation', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'deploy-netlify.yml'), 'utf8');

        expect(workflow).toContain('https://api.vercel.com/v4/aliases/${vercel_production_host}');
        expect(workflow).toContain(".deploymentId // .deployment.id // empty");
        expect(workflow).toContain('test "${vercel_project_id}" = "${VERCEL_PROJECT_ID}"');
        expect(workflow).not.toContain('api.vercel.com/v6/deployments');

        const snapshotIndex = workflow.indexOf('- name: Snapshot current AWS frontend for rollback');
        const snapshotRefIndex = workflow.indexOf('echo "rollback_ref=${GITHUB_SHA}" >> "$GITHUB_OUTPUT"');
        const mutationIndex = workflow.indexOf('- name: Mark AWS production mutation attempt');
        const publishIndex = workflow.indexOf('- name: Publish shared frontend to S3 origin bucket');
        expect(snapshotIndex).toBeGreaterThan(-1);
        expect(snapshotRefIndex).toBeGreaterThan(snapshotIndex);
        expect(mutationIndex).toBeGreaterThan(snapshotRefIndex);
        expect(publishIndex).toBeGreaterThan(mutationIndex);
        expect(workflow).toContain('cleanup_partial_snapshot()');
        expect(workflow).toContain('AWS frontend rollback snapshot failed; removing the partial snapshot.');
        expect(workflow).not.toContain('continuing with the new production deploy');
    });

    test('Vercel storefront rollback verifies immutable org and project ids', () => {
        const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'rollback-storefront-vercel.yml'), 'utf8');
        const script = fs.readFileSync(path.join(repoRoot, 'scripts', 'rollback-storefront-vercel.sh'), 'utf8');

        expect(workflow).toContain('VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID || secrets.VERCEL_ORG_ID }}');
        expect(workflow).toContain('VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID || secrets.VERCEL_PROJECT_ID }}');
        expect(script).toContain('require_env VERCEL_ORG_ID');
        expect(script).toContain('require_env VERCEL_PROJECT_ID');
        expect(script).toContain('--project "${VERCEL_PROJECT_ID}"');
        expect(script).toContain('VERCEL_LINK_FILE="${vercel_link_file}" node');
        expect(script).toContain('linked.orgId !== expectedOrgId || linked.projectId !== expectedProjectId');
        expect(script).toContain('npx vercel rollback status "${VERCEL_PROJECT_ID}"');
        expect(script).not.toContain('VERCEL_STOREFRONT_PROJECT_NAME');
        expect(script).not.toContain('--scope');
    });

    test('AWS rollback workflows keep current tooling separate from rollback targets', () => {
        const backend = yaml.load(
            fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'rollback-backend-aws.yml'), 'utf8'),
            { schema: yaml.JSON_SCHEMA }
        );
        const frontend = yaml.load(
            fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'rollback-frontend-aws.yml'), 'utf8'),
            { schema: yaml.JSON_SCHEMA }
        );

        const backendSteps = new Map(backend.jobs.rollback.steps.map((step) => [step.name, step]));
        const frontendSteps = new Map(frontend.jobs.rollback.steps.map((step) => [step.name, step]));
        const backendToolingCheckout = backendSteps.get('Checkout');
        const frontendToolingCheckout = frontendSteps.get('Checkout');

        expect(JSON.stringify(backendToolingCheckout)).not.toContain('inputs.rollback_ref');
        expect(JSON.stringify(frontendToolingCheckout)).not.toContain('inputs.rollback_ref');
        expect(backendSteps.get('Execute backend rollback hook').env.ROLLBACK_REF)
            .toBe('${{ inputs.rollback_ref }}');
        expect(backendSteps.get('Validate explicit backend rollback release').run)
            .toContain('Backend rollback requires a full known-good release SHA.');
        expect(frontendSteps.get('Execute AWS frontend rollback hook').env.ROLLBACK_REF)
            .toBe('${{ inputs.rollback_ref }}');
        expect(frontendSteps.has('Checkout rebuild rollback source')).toBe(false);
        expect(frontendSteps.has('Setup Node.js for rebuild fallback')).toBe(false);

        const rollbackScript = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'rollback-frontend-s3.sh'), 'utf8');
        expect(rollbackScript).toContain('Refusing to execute target code in the credentialed restore job.');
        expect(rollbackScript).not.toContain('npm --prefix app ci');
        expect(rollbackScript).not.toContain('ROLLBACK_SOURCE_DIR');
    });

    test('gateway production deployment restores its captured alias target on mutation failure', () => {
        const gateway = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'deploy-gateway-vercel.yml'), 'utf8');
        const production = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'production-cicd.yml'), 'utf8');

        const captureIndex = gateway.indexOf('- name: Capture current production gateway deployment');
        const mutationIndex = gateway.indexOf('- name: Mark gateway production mutation attempt');
        const deployIndex = gateway.lastIndexOf('npx vercel deploy');
        const restoreIndex = gateway.indexOf('- name: Restore previous gateway after a failed production mutation');

        expect(captureIndex).toBeGreaterThan(-1);
        expect(mutationIndex).toBeGreaterThan(captureIndex);
        expect(deployIndex).toBeGreaterThan(mutationIndex);
        expect(restoreIndex).toBeGreaterThan(deployIndex);
        expect(gateway).toContain('https://api.vercel.com/v4/aliases/${VERCEL_GATEWAY_ALIAS}');
        expect(gateway).toContain('timeout-minutes: 60');
        expect(gateway).toContain('timeout --signal=TERM --kill-after=30s 30m npx vercel deploy');
        expect(gateway).toContain("if: failure() && steps.mutation.outputs.attempted == 'true'");
        expect(gateway).toContain('ROLLBACK_REF: ${{ steps.rollback_target.outputs.ref }}');
        expect(production).toContain("needs.deploy-gateway.result == 'success'");
        expect(production).toContain('needs.deploy-gateway.outputs.gateway_rollback_ref');
        expect(production).not.toContain("needs.deploy-gateway.outputs.deployment_attempted == 'true' &&\n              needs.deploy-gateway.result == 'failure'");
        expect(production).toContain('backend rollback requires rollback_refs_json.backend as a full known-good commit SHA.');
        expect(production).toContain('needs.deploy-backend.outputs.backend_rollback_ref');
    });

    test('production mutations share one non-canceling lock without reusable-workflow deadlock', () => {
        const production = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'production-cicd.yml'), 'utf8');
        const multiHost = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'deploy-netlify.yml'), 'utf8');
        const gateway = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'deploy-gateway-vercel.yml'), 'utf8');
        const serializedChildren = [
            'deploy-frontend-aws.yml',
            'rollback-netlify.yml',
            'rollback-storefront-vercel.yml',
            'rollback-frontend-aws.yml',
            'rollback-gateway-vercel.yml',
        ].map((filename) => fs.readFileSync(path.join(repoRoot, '.github', 'workflows', filename), 'utf8'));

        expect(production).toContain('group: aura-production-mutation');
        expect(production).toContain('cancel-in-progress: false');
        expect(production.match(/parent_holds_production_lock: true/g)).toHaveLength(7);

        serializedChildren.forEach((workflow) => {
            expect(workflow).toContain('parent_holds_production_lock:');
            expect(workflow).toContain("|| 'aura-production-mutation'");
            expect(workflow).toContain('cancel-in-progress: false');
        });

        expect(multiHost.match(/parent_holds_production_lock: true/g)).toHaveLength(3);
        [multiHost, gateway].forEach((workflow) => {
            expect(workflow).toContain("inputs.target == 'production' && 'aura-production-mutation'");
            expect(workflow).toContain("cancel-in-progress: ${{ inputs.target != 'production' }}");
        });
        expect(multiHost).toContain("format('frontend-{0}'");
        expect(gateway).toContain("format('gateway-vercel-{0}'");
    });

    test('production command-center docs use canonical multi-host rollback contracts', () => {
        const documents = [
            fs.readFileSync(path.join(repoRoot, 'docs', 'ci-cd.md'), 'utf8'),
            fs.readFileSync(path.join(repoRoot, 'docs', 'production-cicd-install.md'), 'utf8'),
        ];

        documents.forEach((document) => {
            expect(document).toContain('deploy_targets=backend,frontend-multihost,gateway');
            expect(document).toContain('rollback_targets=backend,frontend-multihost,gateway');
            expect(document).toContain('rollback_refs_json={"backend":"sha"');
            expect(document).toContain('parent_holds_production_lock');
            expect(document).not.toContain('deploy_targets=backend,frontend-netlify,gateway');
            expect(document).not.toContain('rollback_targets=backend,frontend-netlify,frontend-aws,gateway');
        });
        expect(documents[1]).toMatch(/fails closed unless the\s+requested snapshot has that completion manifest/);
        expect(documents[1]).not.toContain('can rebuild a supplied `ROLLBACK_REF`');
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
        const instanceBootstrap = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'bootstrap-instance-user-data.sh'), 'utf8');
        const oidcBootstrap = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'bootstrap-github-oidc.ps1'), 'utf8');
        const securityPostureBootstrap = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'bootstrap-security-posture.ps1'), 'utf8');
        const renderRuntimeSecrets = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'render-runtime-secrets.sh'), 'utf8');
        const deployRelease = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'deploy-release.sh'), 'utf8');
        const rollbackBackend = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'rollback-backend.sh'), 'utf8');
        const awsCompose = fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'docker-compose.ec2.yml'), 'utf8');
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
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "AUTH_SESSION_ALLOW_MEMORY_FALLBACK" "false"');
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "AUTH_WEBAUTHN_RP_ID" "aurapilot.vercel.app"');
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "AUTH_WEBAUTHN_ORIGIN" "https://aurapilot.vercel.app"');
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "AUTH_WEBAUTHN_USER_VERIFICATION" "required"');
        expect(instanceBootstrap).toMatch(/^MFA_ENABLED=true$/m);
        expect(instanceBootstrap).toMatch(/^MFA_PASSKEY_ENABLED=true$/m);
        expect(instanceBootstrap).toMatch(/^AURA_DESKTOP_OWNER_ACCESS_ENABLED=false$/m);
        expect(awsCompose).toContain('MFA_ENABLED: "true"');
        expect(awsCompose).toContain('MFA_PASSKEY_ENABLED: "true"');
        expect(awsCompose).toContain('AURA_DESKTOP_OWNER_ACCESS_ENABLED: "false"');
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "MFA_ENABLED" "true"');
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "MFA_PASSKEY_ENABLED" "true"');
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "AURA_DESKTOP_OWNER_ACCESS_ENABLED" "false"');
        expect(rollbackBackend).toContain('upsert_env_value "${staged_base_env}" "MFA_ENABLED" "true"');
        expect(rollbackBackend).toContain('upsert_env_value "${staged_base_env}" "MFA_PASSKEY_ENABLED" "true"');
        expect(rollbackBackend).toContain('upsert_env_value "${staged_base_env}" "AURA_DESKTOP_OWNER_ACCESS_ENABLED" "false"');
        expect(instanceBootstrap).toMatch(/^COMPOSE_PROFILES=$/m);
        expect(instanceBootstrap).toMatch(/^AI_MODEL_PROVIDER=disabled$/m);
        expect(instanceBootstrap).toMatch(/^AI_MODEL_PROVIDER_FALLBACKS=$/m);
        expect(instanceBootstrap).toMatch(/^ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED=false$/m);
        expect(instanceBootstrap).toMatch(/^dnf install -y .*\butil-linux\b/m);
        expect(deployRelease).toContain('sanitize_compose_profiles()');
        expect(deployRelease).toContain('malware-scan)');
        expect(deployRelease).toContain("''|ollama)");
        expect(deployRelease).toContain("Refusing deploy: unsupported production Compose profile");
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "COMPOSE_PROFILES" "${compose_profiles}"');
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "AI_MODEL_PROVIDER" "disabled"');
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "AI_MODEL_PROVIDER_FALLBACKS" ""');
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA" "false"');
        expect(deployRelease).toContain('upsert_env_value "${staged_base_env}" "ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED" "false"');
        expect(deployRelease).toContain('AURA_RUNTIME_SECRETS_FILE="${staged_runtime_env}"');
        expect(deployRelease).toContain('mv "${staged_base_env}" "${shared_dir}/base.env"');
        expect(deployRelease).toContain('mv "${staged_runtime_env}" "${shared_dir}/runtime-secrets.env"');
        expect(deployRelease).toContain('cp -p "${shared_dir}/base.env" "${activation_backup_base_env}"');
        expect(deployRelease).toContain('cp -p "${shared_dir}/runtime-secrets.env" "${activation_backup_runtime_env}"');
        expect(deployRelease).toContain('preserved activation recovery state exists');
        expect(deployRelease).toContain('preserved activation recovery state requires operator recovery');
        expect(deployRelease).toContain('AURA_PREVIOUS_SUCCESSFUL_SHA=${previous_active_sha}');
        expect(deployRelease).toContain('same-SHA redeploys cannot preserve an immutable rollback target');
        expect(deployRelease.indexOf('same-SHA redeploys cannot preserve an immutable rollback target')).toBeLessThan(deployRelease.indexOf('aws s3 cp --region "${aws_region}"'));
        expect(deployRelease).toContain('cleanup_old_release_dirs "${deploy_root}/releases" 3 "${release_sha}" "${previous_active_sha}"');
        expect(deployRelease).not.toContain('cleanup_old_release_dirs "${deploy_root}/releases" 3\n');
        expect(deployRelease).toContain('[[ -n "${staged_runtime_env}" ]] && rm -f "${staged_runtime_env}" || true');
        expect(deployRelease).toContain('staged_current_dir="${release_dir}/current.staged"');
        expect(deployRelease).toContain('assert_no_model_compose_contract "${staged_compose_file}"');
        expect(deployRelease).toContain('release_lock_path="${deploy_root}/.backend-release.lock"');
        expect(deployRelease).toContain('flock --exclusive --nonblock 9');
        expect(deployRelease.indexOf('trap release_exit_handler EXIT')).toBeLessThan(deployRelease.indexOf('acquire_release_lock "${release_lock_path}"'));
        expect(deployRelease.indexOf('acquire_release_lock "${release_lock_path}"')).toBeLessThan(deployRelease.indexOf('mkdir -p "${release_dir}" "${shared_dir}"'));
        expect(deployRelease.indexOf('compose_profiles="$(sanitize_compose_profiles')).toBeLessThan(deployRelease.lastIndexOf('rm -rf "${current_dir}"'));
        expect(deployRelease.indexOf('assert_no_model_compose_contract "${staged_compose_file}"')).toBeLessThan(deployRelease.lastIndexOf('rm -rf "${current_dir}"'));
        expect(deployRelease).toMatch(/cat > "\$\{staged_release_env\}" <<EOF[\s\S]*AI_MODEL_PROVIDER=disabled[\s\S]*ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED=false/);
        expect(deployRelease).toContain('export COMPOSE_PROFILES="${compose_profiles}"');
        expect(deployRelease).toMatch(/--profile ollama\s+\\\s+rm --stop --force ollama/);
        expect(deployRelease).not.toContain('rm --volumes');
        expect(deployRelease).not.toContain('down -v');
        expect(deployRelease).toContain('restore_previous_release()');
        expect(deployRelease).toContain('Release activation failed; restoring the previous backend state.');
        expect(deployRelease).toContain('up -d --remove-orphans --force-recreate');
        expect(deployRelease.indexOf('cp -a "${current_dir}" "${activation_backup_dir}"')).toBeLessThan(deployRelease.indexOf('activation_started=true'));
        expect(deployRelease.indexOf('activation_started=true')).toBeLessThan(deployRelease.lastIndexOf('rm -rf "${current_dir}"'));
        expect(deployRelease.lastIndexOf('rm -rf "${current_dir}"')).toBeLessThan(deployRelease.indexOf('mv "${staged_current_dir}" "${current_dir}"'));
        expect(deployRelease.indexOf('activation_committed=true')).toBeGreaterThan(deployRelease.indexOf('if [[ "${edge_ready}" == "true" ]]'));
        expect(rollbackBackend).toContain('sanitize_compose_profiles()');
        expect(rollbackBackend).toContain('staged_current_dir="${target_dir}/current.staged"');
        expect(rollbackBackend).toContain('release_lock_path="${deploy_root}/.backend-release.lock"');
        expect(rollbackBackend).toContain('flock --exclusive --nonblock 9');
        expect(rollbackBackend.indexOf('trap release_exit_handler EXIT')).toBeLessThan(rollbackBackend.indexOf('acquire_release_lock "${release_lock_path}"'));
        expect(rollbackBackend.indexOf('acquire_release_lock "${release_lock_path}"')).toBeLessThan(rollbackBackend.indexOf('mkdir -p "${shared_dir}"'));
        expect(rollbackBackend).toContain('upsert_env_value "${staged_base_env}" "COMPOSE_PROFILES" "${compose_profiles}"');
        expect(rollbackBackend).toContain('upsert_env_value "${staged_base_env}" "AI_MODEL_PROVIDER" "disabled"');
        expect(rollbackBackend).toContain('upsert_env_value "${staged_base_env}" "AI_MODEL_PROVIDER_FALLBACKS" ""');
        expect(rollbackBackend).toContain('upsert_env_value "${staged_base_env}" "ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA" "false"');
        expect(rollbackBackend).toContain('upsert_env_value "${staged_base_env}" "ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED" "false"');
        expect(rollbackBackend).toContain('AURA_RUNTIME_SECRETS_FILE="${staged_runtime_env}"');
        expect(rollbackBackend).toContain('mv "${staged_base_env}" "${base_env}"');
        expect(rollbackBackend).toContain('mv "${staged_runtime_env}" "${runtime_env}"');
        expect(rollbackBackend).toContain('cp -p "${base_env}" "${activation_backup_base_env}"');
        expect(rollbackBackend).toContain('cp -p "${runtime_env}" "${activation_backup_runtime_env}"');
        expect(rollbackBackend).toContain('preserved activation recovery state exists');
        expect(rollbackBackend).toContain('preserved activation recovery state requires operator recovery');
        expect(rollbackBackend).toContain('Refusing rollback: an explicit known-good ROLLBACK_REF is required.');
        expect(rollbackBackend).toContain('AURA_PREVIOUS_SUCCESSFUL_SHA=${current_sha}');
        expect(rollbackBackend).not.toContain("! -name \"${current_sha}\"");
        expect(rollbackBackend).toContain('[[ -n "${staged_runtime_env}" ]] && rm -f "${staged_runtime_env}" || true');
        expect(rollbackBackend).toContain("grep -q 'InvocationDoesNotExist'");
        expect(rollbackBackend.indexOf('compose_profiles="$(sanitize_compose_profiles')).toBeLessThan(rollbackBackend.lastIndexOf('rm -rf "${current_dir}"'));
        expect(rollbackBackend.indexOf('assert_no_model_compose_contract "${staged_compose_file}"')).toBeLessThan(rollbackBackend.lastIndexOf('rm -rf "${current_dir}"'));
        expect(rollbackBackend).toMatch(/cat > "\$\{staged_release_env\}" <<EOF[\s\S]*AI_MODEL_PROVIDER=disabled[\s\S]*ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED=false/);
        expect(rollbackBackend).toContain('export COMPOSE_PROFILES="${compose_profiles}"');
        expect(rollbackBackend).toContain('export AI_MODEL_PROVIDER="disabled"');
        expect(rollbackBackend).toContain('export AI_MODEL_PROVIDER_FALLBACKS=""');
        expect(rollbackBackend).toContain('export ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA="false"');
        expect(rollbackBackend).toContain('export ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED="false"');
        expect(rollbackBackend).toMatch(/--profile ollama\s+\\\s+rm --stop --force ollama/);
        expect(rollbackBackend).not.toContain('rm --volumes');
        expect(rollbackBackend).not.toContain('down -v');
        expect(rollbackBackend).toContain('restore_previous_release()');
        expect(rollbackBackend).toContain('Rollback activation failed; restoring the backend state that preceded it.');
        expect(rollbackBackend).toContain('up -d --remove-orphans --force-recreate');
        expect(rollbackBackend.indexOf('cp -a "${current_dir}" "${activation_backup_dir}"')).toBeLessThan(rollbackBackend.indexOf('activation_started=true'));
        expect(rollbackBackend.indexOf('activation_started=true')).toBeLessThan(rollbackBackend.lastIndexOf('rm -rf "${current_dir}"'));
        expect(rollbackBackend.lastIndexOf('rm -rf "${current_dir}"')).toBeLessThan(rollbackBackend.indexOf('mv "${staged_current_dir}" "${current_dir}"'));
        expect(rollbackBackend.indexOf('activation_committed=true')).toBeGreaterThan(rollbackBackend.indexOf('if [[ "${edge_ready}" != "true" ]]'));
        expect(awsCompose.match(/^\s+AI_MODEL_PROVIDER: disabled$/gm)).toHaveLength(2);
        expect(awsCompose.match(/^\s+AI_MODEL_PROVIDER_FALLBACKS: ""$/gm)).toHaveLength(2);
        expect(awsCompose.match(/^\s+ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA: "false"$/gm)).toHaveLength(2);
        expect(awsCompose.match(/^\s+ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED: "false"$/gm)).toHaveLength(2);
        expect(awsCompose).toContain('aura-ollama:/root/.ollama');

        expect(workflow).toContain('sha256sum "${RUNNER_TEMP}/aura-infra-${AURA_RELEASE_SHA}.tar.gz"');
        expect(workflow).toContain('sha256sum "${RUNNER_TEMP}/aura-image-${AURA_RELEASE_SHA}.tar.gz"');
        expect(workflow).toContain('sha256sum --check --status');
        expect(workflow).toContain('AURA_INFRA_BUNDLE_SHA256');
        expect(workflow).toContain('AURA_IMAGE_BUNDLE_SHA256');
        expect(workflow).toContain('Resolve immutable release commit');
        expect(workflow).toContain('AURA_RELEASE_SHA: ${{ needs.preflight.outputs.release_sha }}');
        expect(workflow).toContain('ref: ${{ needs.preflight.outputs.release_sha }}');
        expect(workflow).toContain('releases/${AURA_RELEASE_SHA}/infra.tar.gz');
        expect(workflow).toContain('for _ in $(seq 1 240)');
        expect(workflow).toContain('timeout-minutes: 120');
        expect(workflow).toContain('Configure fresh AWS credentials for deployment');
        expect(workflow).toContain('Refresh AWS credentials for failure restoration');
        expect(workflow.match(/InvocationDoesNotExist/g)).toHaveLength(2);
        expect(workflow.indexOf('Build backend container image')).toBeLessThan(workflow.indexOf('Configure fresh AWS credentials for deployment'));
        expect(workflow.indexOf('Configure fresh AWS credentials for deployment')).toBeLessThan(workflow.indexOf('Upload deployment artifacts to S3'));
        expect(workflow).not.toContain('releases/${GITHUB_SHA}/infra.tar.gz');
        expect(workflow).toContain('Capture current backend rollback release');
        expect(workflow).toContain('refusing a same-SHA redeploy that would overwrite rollback artifacts');
        expect(workflow.indexOf('Capture current backend rollback release')).toBeLessThan(workflow.indexOf('Upload deployment artifacts to S3'));
        expect(workflow).toContain('backend_rollback_ref:');
        expect(workflow).toContain('Current backend release metadata is missing or malformed; refusing mutation.');
        expect(workflow).toContain('id: wait_ssm');
        expect(workflow).toContain('Restore previous backend after post-activation verification failure');
        expect(workflow).toContain("if: failure() && steps.wait_ssm.outcome == 'success' && steps.current_release.outputs.sha != ''");
        expect(workflow).toContain("if: failure() && steps.rollback_credentials.outcome == 'success' && steps.current_release.outputs.sha != ''");
        expect(workflow).toContain('ROLLBACK_REF: ${{ steps.current_release.outputs.sha }}');
    });

    test('AWS production profile sanitizers execute fail closed', () => {
        const scripts = [
            fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'deploy-release.sh'), 'utf8'),
            fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'rollback-backend.sh'), 'utf8'),
        ];

        scripts.forEach((source) => {
            expect(runComposeProfileSanitizer(source, '').output).toBe('');
            expect(runComposeProfileSanitizer(source, 'ollama').output).toBe('');
            expect(runComposeProfileSanitizer(source, ' OLLAMA , malware-scan ').output).toBe('malware-scan');

            const unsupported = runComposeProfileSanitizer(source, 'malware-scan,debug-shell');
            expect(unsupported.status).not.toBe(0);
            expect(unsupported.output).toContain('unsupported production Compose profile');
        });
    });

    test('AWS backend release locks execute fail closed and release on exit', () => {
        const scripts = [
            fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'deploy-release.sh'), 'utf8'),
            fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'rollback-backend.sh'), 'utf8'),
        ];

        scripts.forEach((source) => {
            const acquired = runReleaseLockProbe(source, 'available');
            expect(acquired).toMatchObject({ status: 0, output: 'critical-section\n' });
            expect(acquired.trace.trim().split(/\r?\n/)).toEqual([
                '--exclusive --nonblock 9',
                '--unlock 9',
            ]);

            const contended = runReleaseLockProbe(source, 'contended');
            expect(contended.status).not.toBe(0);
            expect(contended.output).toContain('another deploy or rollback is already running');
            expect(contended.output).not.toContain('critical-section');
            expect(contended.trace.trim()).toBe('--exclusive --nonblock 9');
        });
    });

    test('failed backend activations restore and restart the previous no-model release', () => {
        const scripts = [
            fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'deploy-release.sh'), 'utf8'),
            fs.readFileSync(path.join(repoRoot, 'infra', 'aws', 'rollback-backend.sh'), 'utf8'),
        ];

        scripts.forEach((source) => {
            const restored = runActivationRestoreProbe(source);
            expect(restored.status).toBe(0);
            expect(restored.trace).toContain('down --remove-orphans');
            expect(restored.trace).toContain('up -d --remove-orphans --force-recreate');
            expect(restored.trace).not.toContain('down -v');
        });
    });

    test('backend container build contexts package the shared assistant capability manifest', () => {
        const rootDockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
        const serverDockerfile = fs.readFileSync(path.join(repoRoot, 'server', 'Dockerfile'), 'utf8');
        const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
        const deployWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'deploy-backend-aws.yml'), 'utf8');
        const splitCompose = fs.readFileSync(path.join(repoRoot, 'docker-compose.split-runtime.yml'), 'utf8');
        const performanceCompose = fs.readFileSync(path.join(repoRoot, 'infra', 'performance', 'docker-compose.performance.yml'), 'utf8');
        const stagingCompose = fs.readFileSync(path.join(repoRoot, 'infra', 'staging', 'docker-compose.yml'), 'utf8');
        const stagingDeploy = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '07-deploy-compose.sh'), 'utf8');
        const rootDockerignore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');
        const backendContextCallerPaths = [
            'scripts/security/trivy-image.sh',
            'scripts/staging/07-deploy-compose.sh',
            'infra/performance/docker-compose.performance.yml',
            'infra/staging/docker-compose.yml',
        ];

        expect(rootDockerfile).toContain('shared/assistantCapabilities.json /app/shared/assistantCapabilities.json');
        expect(rootDockerfile).toContain('config/desktopAuthLoopback.cjs /app/config/desktopAuthLoopback.cjs');
        expect(serverDockerfile).toContain('COPY server/package*.json ./');
        expect(serverDockerfile).toContain('COPY --chown=node:node server ./');
        expect(serverDockerfile).toContain('shared/assistantCapabilities.json /shared/assistantCapabilities.json');
        expect(serverDockerfile).toContain('config/desktopAuthLoopback.cjs /config/desktopAuthLoopback.cjs');
        expect(ciWorkflow).toContain('docker build --file server/Dockerfile --tag aura-backend-ci .');
        expect(ciWorkflow).toContain("require('./services/ai/assistantToolRegistry')");
        expect(deployWorkflow).toMatch(/--file server\/Dockerfile[\s\S]*--load \\\n\s+\./);
        expect(splitCompose.match(/dockerfile: server\/Dockerfile/g)).toHaveLength(2);
        expect(performanceCompose).toContain('dockerfile: server/Dockerfile');
        expect(stagingCompose).toContain('dockerfile: server/Dockerfile');
        expect(stagingDeploy).toMatch(/server \\\n\s+shared \\\n\s+infra\/staging/);
        expect(stagingDeploy).toContain('"$REPO_ROOT/server/Dockerfile"');
        backendContextCallerPaths.forEach((callerPath) => {
            expect(ciWorkflow).toContain(`- "${callerPath}"`);
        });
        expect(ciWorkflow).toContain(backendContextCallerPaths.join('|'));
        expect(rootDockerignore).toContain('.student-pack.local.env');
        expect(rootDockerignore).toContain('server/tests');
        expect(rootDockerignore).toContain('server/seeders');
        expect(rootDockerignore).toContain('server/test_results*.json');
        expect(rootDockerignore).toContain('server/Dockerfile*');
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
        const costGuardConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'aws-free-guard.json'), 'utf8'));
        const observabilityGuard = fs.readFileSync(path.join(repoRoot, 'scripts', 'aws', 'assert-observability-guard.mjs'), 'utf8');
        const branchProtectionGuard = fs.readFileSync(path.join(repoRoot, 'scripts', 'github', 'assert-main-protection.mjs'), 'utf8');
        expect(costGuard).toContain("emitEvidence('blocked')");
        expect(costGuard).toContain("'budgets', 'describe-budget'");
        expect(costGuard).toContain('forecast is unavailable');
        expect(costGuardConfig.requiredBudgets).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'aura-staging-monthly-budget', maxMonthlyUsd: 30 }),
            expect.objectContaining({ name: 'aura-backend-monthly-guardrail', maxMonthlyUsd: 90 }),
        ]));
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

    test.each([
        ['rollback-backend-aws.yml', 'Execute backend rollback hook'],
        ['rollback-frontend-aws.yml', 'Execute AWS frontend rollback hook'],
    ])('%s keeps manual OIDC validation non-mutating', (filename, rollbackStepName) => {
        const workflow = yaml.load(
            fs.readFileSync(path.join(repoRoot, '.github', 'workflows', filename), 'utf8'),
            { schema: yaml.JSON_SCHEMA }
        );
        const rollbackJob = workflow.jobs.rollback;
        const stepByName = new Map(rollbackJob.steps.map((step) => [step.name, step]));
        const executionInput = workflow.on.workflow_call.inputs.execute_rollback;

        expect(Object.prototype.hasOwnProperty.call(workflow.on, 'workflow_call')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(workflow.on, 'workflow_dispatch')).toBe(true);
        expect(executionInput).toMatchObject({ default: false, type: 'boolean' });
        expect(workflow.permissions['id-token']).toBe('write');
        expect(rollbackJob.environment).toBeUndefined();
        expect(stepByName.get('Verify AWS rollback identity').run).toContain('sts get-caller-identity');
        expect(stepByName.get('Checkout').if).toBe('inputs.execute_rollback == true');
        expect(stepByName.get(rollbackStepName).if).toBe('inputs.execute_rollback == true');
        expect(stepByName.get('Confirm credential-only validation').if).toBe('inputs.execute_rollback != true');
    });

    test('AWS backend deploy and rollback workflows serialize on the same concurrency group', () => {
        const deployWorkflow = yaml.load(
            fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'deploy-backend-aws.yml'), 'utf8'),
            { schema: yaml.JSON_SCHEMA }
        );
        const rollbackWorkflow = yaml.load(
            fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'rollback-backend-aws.yml'), 'utf8'),
            { schema: yaml.JSON_SCHEMA }
        );

        expect(deployWorkflow.concurrency).toEqual({
            group: 'aws-backend-production',
            'cancel-in-progress': false,
        });
        expect(rollbackWorkflow.concurrency).toEqual(deployWorkflow.concurrency);
    });

    test('production command center explicitly authorizes both AWS rollback hooks', () => {
        const workflow = yaml.load(
            fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'production-cicd.yml'), 'utf8'),
            { schema: yaml.JSON_SCHEMA }
        );

        expect(workflow.jobs['rollback-backend'].with.execute_rollback).toBe(true);
        expect(workflow.jobs['rollback-frontend-aws'].with.execute_rollback).toBe(true);
    });

    test('free-tier AWS guard config blocks expensive services by default', () => {
        const guard = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'aws-free-guard.json'), 'utf8'));
        const budgetScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'staging', '01-create-budget.sh'), 'utf8');

        expect(guard.region).toBe('ap-south-1');
        expect(guard.maxMonthlyUsd).toBeLessThanOrEqual(30);
        expect(guard.requiredBudgets).toContainEqual({
            name: 'aura-staging-monthly-budget',
            maxMonthlyUsd: 30,
        });
        expect(guard.allowNatGateway).toBe(false);
        expect(guard.allowLoadBalancer).toBe(false);
        expect(guard.allowPaidRds).toBe(false);
        expect(guard.allowPaidElasticache).toBe(false);
        expect(guard.allowOpenSearch).toBe(false);
        expect(guard.requiredSsmPrefixes).toEqual(expect.arrayContaining(['/aura/staging', '/aura/prod']));
        expect(budgetScript).toContain('"NotificationType": "FORECASTED"');
        expect(budgetScript).toContain('--subscribers "$(aws_file_uri "$subscribers_file")"');
    });
});
