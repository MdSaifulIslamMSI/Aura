const { execFileSync, spawnSync } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const bucket = 'aura-policy-test';
const owner = '123456789012';
const baseArgs = ['--region', 'ap-south-1', '--bucket', bucket];
const applyArgs = ['--apply', '--expected-bucket-owner', owner];
const existing = {
    Version: '2012-10-17',
    Id: 'keep-policy-metadata',
    Statement: [
        { Sid: 'ExistingGrant', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${owner}:root` }, Action: 's3:GetObject', Resource: `arn:aws:s3:::${bucket}/*` },
        { Sid: 'UnknownDeny', Effect: 'Deny', Principal: '*', NotAction: 's3:GetObject', NotResource: `arn:aws:s3:::${bucket}/public/*`, Condition: { StringEquals: { 'aws:PrincipalTag/lane': 'restricted' } } },
        { Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 's3:GetObject', Resource: `arn:aws:s3:::${bucket}/*`, Condition: { StringEquals: { 'AWS:SourceArn': `arn:aws:cloudfront::${owner}:distribution/EXAMPLE` } } },
    ],
};
const ok = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });
const identity = ok({ Account: owner, Arn: `arn:aws:iam::${owner}:user/policy-operator` });
const policyReply = (policy) => ok({ Policy: JSON.stringify(policy) });
const awsFailure = (code, operation = 'GetBucketPolicy') => ({ status: 254, stdout: '', stderr: `An error occurred (${code}) when calling the ${operation} operation: secret-fixture-do-not-log` });
const missing = awsFailure('NoSuchBucketPolicy');

// Native Node imports ESM outside Jest's CJS VM; only built-ins are needed in CI.
const runModule = (body) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { buildHttpsPolicy, main } from './scripts/security/enforce-s3-https.mjs';
    const result = (() => { ${body} })();
    console.log(JSON.stringify(result));
`], { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 15000 }));

const build = (policy = null, options = {}, name = bucket) => runModule(`
    return buildHttpsPolicy(${JSON.stringify(name)}, ${JSON.stringify(policy)}, ${JSON.stringify(options)});
`);
const buildError = (policy, options = {}, name = bucket) => runModule(`
    try { buildHttpsPolicy(${JSON.stringify(name)}, ${JSON.stringify(policy)}, ${JSON.stringify(options)}); }
    catch (error) { return error.message; }
    return null;
`);
const runUtility = (args, replies) => runModule(`
    const calls = [], logs = [], errors = [];
    const replies = ${JSON.stringify(replies)};
    const code = main(${JSON.stringify(args)}, {
        spawn(command, args, options) {
            calls.push({ command, args, options: {
                shell: options.shell, timeout: options.timeout, maxBuffer: options.maxBuffer,
                encoding: options.encoding, pager: options.env.AWS_PAGER,
                autoPrompt: options.env.AWS_CLI_AUTO_PROMPT, attempts: options.env.AWS_MAX_ATTEMPTS,
            } });
            const reply = replies.shift();
            if (!reply) throw new Error('Unexpected mock AWS invocation');
            if (reply.written) {
                const put = calls.find((call) => call.args[1] === 'put-bucket-policy');
                const policy = JSON.parse(put.args[put.args.indexOf('--policy') + 1]);
                if (reply.reverseKeys) {
                    const reordered = Object.fromEntries(Object.entries(policy).reverse());
                    return { status: 0, stdout: JSON.stringify({ Policy: JSON.stringify(reordered) }) };
                }
                return { status: 0, stdout: JSON.stringify({ Policy: JSON.stringify(policy) }) };
            }
            return reply;
        },
        log: (line) => logs.push(JSON.parse(line)),
        error: (line) => errors.push(JSON.parse(line)),
    });
    return { code, calls, logs, errors, remaining: replies.length };
`);
const operations = (result) => result.calls.map((call) => call.args[1]);

// No test invokes the real AWS executable, including failure-path coverage.
describe('S3 HTTPS-only policy maintenance', () => {
    test('appends the canonical denial and preserves all unknown grants, denies and metadata without mutating input', () => {
        const result = runModule(`
            const input = ${JSON.stringify(existing)};
            const original = JSON.stringify(input);
            const after = buildHttpsPolicy('${bucket}', input);
            return { after, unchangedInput: original === JSON.stringify(input) };
        `);
        expect(result.unchangedInput).toBe(true);
        expect(result.after.Id).toBe(existing.Id);
        expect(result.after.Statement.slice(0, 3)).toEqual(existing.Statement);
        expect(result.after.Statement[3]).toEqual({
            Sid: 'DenyInsecureTransport', Effect: 'Deny', Principal: '*', Action: 's3:*',
            Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
            Condition: { Bool: { 'aws:SecureTransport': 'false', 'aws:PrincipalIsAWSService': 'false' } },
        });
    });

    test('creates a policy only when none exists, supports partitions, and is idempotent', () => {
        const policy = build(null, { partition: 'aws-cn' });
        expect(policy.Version).toBe('2012-10-17');
        expect(policy.Statement).toHaveLength(1);
        expect(policy.Statement[0].Resource[0]).toBe(`arn:aws-cn:s3:::${bucket}`);
        expect(build(policy, { partition: 'aws-cn' })).toEqual(policy);
    });

    test('keeps singleton statements and does not upgrade legacy/missing policy versions', () => {
        const singleton = { Id: 'legacy', Statement: existing.Statement[0] };
        const after = build(singleton);
        expect(after.Version).toBeUndefined();
        expect(after.Statement[0]).toEqual(singleton.Statement);
        expect(build({ Version: '2008-10-17', Statement: [] }).Version).toBe('2008-10-17');
        const compliantSingleton = { Statement: build().Statement[0] };
        expect(build(compliantSingleton)).toEqual(compliantSingleton);
    });

    test('refuses conflicting and duplicate managed SIDs, even an old deny lacking the service exemption', () => {
        const deny = build().Statement[0];
        const oldDeny = { ...deny, Condition: { Bool: { 'aws:SecureTransport': 'false' } } };
        expect(buildError({ Statement: [oldDeny] })).toContain('SID collision: DenyInsecureTransport');
        expect(buildError({ Statement: [deny, deny] })).toContain('SID collision');
        expect(buildError({ Statement: [{ ...deny, Effect: 'Allow' }] })).toContain('SID collision');
    });

    test('append-only bootstrap grants preserve unknown statements, deduplicate exact grants and fail on SID drift', () => {
        const grant = { ...existing.Statement[0], Sid: 'BootstrapGrant' };
        const after = build(existing, { additionalStatements: [grant] });
        expect(after.Statement.slice(0, 3)).toEqual(existing.Statement);
        expect(after.Statement[3]).toEqual(grant);
        expect(build(after, { additionalStatements: [grant] })).toEqual(after);
        expect(buildError(after, { additionalStatements: [{ ...grant, Action: 's3:*' }] })).toContain('SID collision: BootstrapGrant');
        expect(buildError(null, { additionalStatements: [{ Effect: 'Allow' }] })).toContain('require a nonempty');
    });

    test.each([[], 'text', { Statement: null }, { Statement: [null] }, { Statement: [1] }, { Version: 'bogus', Statement: [] }])('rejects malformed policy %j instead of treating it as absent', (policy) => {
        expect(buildError(policy)).toMatch(/Invalid bucket policy/);
    });

    test('rejects oversized policies and unsupported partitions', () => {
        expect(buildError({ Id: 'x'.repeat(21000), Statement: [] })).toContain('size limit');
        expect(buildError(null, { partition: 'unknown' })).toContain('Unsupported AWS partition');
    });

    test('defaults to dry-run and emits policy evidence and deterministic SHA-256 without any writes', () => {
        const result = runUtility([...baseArgs, '--profile', 'audit', '--expected-bucket-owner', owner], [identity, policyReply(existing)]);
        expect(result.code).toBe(0);
        expect(operations(result)).toEqual(['get-caller-identity', 'get-bucket-policy']);
        expect(result.logs[0]).toMatchObject({ mode: 'dry-run', action: 'planned', ownerVerified: true, before: { policy: existing } });
        const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
            ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
        expect(result.logs[0].before.sha256).toBe(createHash('sha256').update(stable(existing)).digest('hex'));
        expect(result.logs[0].after.policy.Statement.slice(0, 3)).toEqual(existing.Statement);
        expect(result.logs[1]).toMatchObject({ action: 'summary', completedBuckets: 1, status: 'ok' });
        for (const call of result.calls) {
            expect(call.command).toBe('aws');
            expect(call.options).toEqual({ shell: false, timeout: 30000, maxBuffer: 1048576, encoding: 'utf8', pager: '', autoPrompt: 'off', attempts: '2' });
            expect(call.args).toEqual(expect.arrayContaining(['--profile', 'audit', '--region', 'ap-south-1', '--no-cli-pager', '--output', 'json', '--cli-connect-timeout', '10', '--cli-read-timeout', '20']));
        }
        expect(result.calls[1].args).toEqual(expect.arrayContaining(['--expected-bucket-owner', owner]));
    });

    test('explicit dry-run can read a missing policy without owner verification or a put', () => {
        const result = runUtility([...baseArgs, '--dry-run'], [identity, missing]);
        expect(result.code).toBe(0);
        expect(operations(result)).not.toContain('put-bucket-policy');
        expect(result.logs[0]).toMatchObject({ ownerVerified: false, before: { policy: null } });
        expect(result.logs[0].after.policy.Statement).toHaveLength(1);
    });

    test.each(['AccessDenied', 'NoSuchBucket', 'ExpiredToken', 'PermanentRedirect', 'InternalError'])('fails closed on %s, without leaking CLI stderr', (code) => {
        const result = runUtility([...baseArgs, ...applyArgs], [identity, awsFailure(code)]);
        expect(result.code).toBe(1);
        expect(operations(result)).not.toContain('put-bucket-policy');
        expect(result.errors[0].message).toContain(code);
        expect(result.errors[0].bucket).toBe(bucket);
        expect(JSON.stringify(result)).not.toContain('secret-fixture-do-not-log');
    });

    test.each([
        { status: null, signal: 'SIGTERM', stderr: 'secret-fixture-do-not-log' },
        { status: null, error: { code: 'ETIMEDOUT' }, stderr: missing.stderr },
        { status: 254, stderr: 'unrecognized failure secret-fixture-do-not-log' },
        awsFailure('NoSuchBucketPolicy', 'GetCallerIdentity'),
    ])('does not misclassify other CLI failures as absent policies: %j', (failure) => {
        const result = runUtility([...baseArgs, ...applyArgs], [identity, failure]);
        expect(result.code).toBe(1);
        expect(operations(result)).not.toContain('put-bucket-policy');
        expect(JSON.stringify(result)).not.toContain('secret-fixture-do-not-log');
    });

    test('missing CLI and timeouts have distinguishable safe errors, never raw process messages', () => {
        for (const code of ['ENOENT', 'ETIMEDOUT']) {
            const result = runUtility([...baseArgs, ...applyArgs], [identity, { status: null, error: { code, message: 'secret-fixture-do-not-log' } }]);
            expect(result.code).toBe(1);
            expect(result.errors[0].message).toContain(code);
            expect(JSON.stringify(result)).not.toContain('secret-fixture-do-not-log');
        }
    });

    test('managed SID collisions stop apply before any write', () => {
        const result = runUtility([...baseArgs, ...applyArgs], [identity, policyReply({ Statement: [{ Sid: 'DenyInsecureTransport', Effect: 'Allow' }] })]);
        expect(result.code).toBe(1);
        expect(operations(result)).not.toContain('put-bucket-policy');
        expect(result.errors[0].message).toContain('SID collision');
    });

    test.each([
        ok({}), ok({ Policy: null }), ok({ Policy: 'not JSON' }),
        { status: 0, stdout: 'not JSON' }, policyReply({ Statement: null }),
    ])('fails closed on malformed policy responses: %j', (reply) => {
        const result = runUtility([...baseArgs, ...applyArgs], [identity, reply]);
        expect(result.code).toBe(1);
        expect(operations(result)).not.toContain('put-bucket-policy');
    });

    test.each([
        ['--apply'], ['--apply', '--dry-run'], ['--expected-bucket-owner', '123'], ['--bucket'],
        ['--unknown'], ['--bucket', 'UPPERCASE'], ['--bucket', 'https://example.com'], ['--bucket', 'a..b'],
        ['--bucket', '192.168.0.1'], ['--region', 'bad-region'], ['--profile', 'profile;echo'],
        ['--profile', 'one', '--profile', 'two'],
    ])('rejects unsafe arguments before any AWS call: %j', (...extra) => {
        const result = runUtility([...baseArgs, ...extra], []);
        expect(result.code).toBe(1);
        expect(result.calls).toEqual([]);
    });

    test('requires both an explicit bucket and region', () => {
        expect(runUtility(['--region', 'ap-south-1'], []).code).toBe(1);
        expect(runUtility(['--bucket', bucket], []).code).toBe(1);
    });

    test.each([
        ok({ Account: '999999999999', Arn: 'arn:aws:iam::999999999999:root' }),
        ok({ Account: 'not-an-account' }), ok({ Account: owner, Arn: 'invalid' }),
        awsFailure('ExpiredToken', 'GetCallerIdentity'),
    ])('fails closed when identity or expected account cannot be verified: %j', (reply) => {
        const result = runUtility([...baseArgs, ...applyArgs], [reply]);
        expect(result.code).toBe(1);
        expect(operations(result)).toEqual(['get-caller-identity']);
    });

    test('apply rereads, writes only the merged bucket policy, and verifies exact readback while ignoring object key order', () => {
        const result = runUtility([...baseArgs, ...applyArgs], [identity, policyReply(existing), policyReply(existing), ok({}), { written: true, reverseKeys: true }]);
        expect(result.code).toBe(0);
        expect(operations(result)).toEqual(['get-caller-identity', 'get-bucket-policy', 'get-bucket-policy', 'put-bucket-policy', 'get-bucket-policy']);
        const putArgs = result.calls[3].args;
        expect(JSON.parse(putArgs[putArgs.indexOf('--policy') + 1])).toEqual(build(existing));
        for (const call of result.calls.slice(1)) expect(call.args).toEqual(expect.arrayContaining(['--expected-bucket-owner', owner]));
        expect(result.logs[1]).toMatchObject({ action: 'verified', observed: { policy: build(existing) } });
        expect(result.logs[1].observed.sha256).toBe(result.logs[0].after.sha256);
    });

    test('apply initializes only a confirmed absent policy', () => {
        const result = runUtility([...baseArgs, ...applyArgs], [identity, missing, missing, ok({}), { written: true }]);
        expect(result.code).toBe(0);
        expect(result.logs[0].before.policy).toBeNull();
        expect(result.logs[1].action).toBe('verified');
    });

    test('compliant apply is a no-op and repeat buckets are read only once', () => {
        const result = runUtility([...baseArgs, ...applyArgs, '--bucket', bucket], [identity, policyReply(build(existing))]);
        expect(result.code).toBe(0);
        expect(operations(result)).toEqual(['get-caller-identity', 'get-bucket-policy']);
        expect(result.logs[0].action).toBe('unchanged');
    });

    test('multiple buckets are explicit, separate policy plans', () => {
        const result = runUtility([...baseArgs, '--bucket', 'another-policy-test'], [identity, missing, missing]);
        expect(result.code).toBe(0);
        expect(result.logs[1].after.policy.Statement[0].Resource[0]).toBe('arn:aws:s3:::another-policy-test');
        expect(result.logs[2]).toMatchObject({ completedBuckets: 2, requestedBuckets: 2 });
    });

    test.each([null, { ...existing, Id: 'changed-by-another-operator' }])('refuses concurrent policy changes before put: %j', (latest) => {
        const result = runUtility([...baseArgs, ...applyArgs], [identity, policyReply(existing), latest === null ? missing : policyReply(latest)]);
        expect(result.code).toBe(1);
        expect(operations(result)).not.toContain('put-bucket-policy');
        expect(result.logs[1]).toMatchObject({ action: 'concurrent-change', observed: { policy: latest } });
    });

    test('a pre-write permission error never becomes permission to overwrite', () => {
        const result = runUtility([...baseArgs, ...applyArgs], [identity, missing, awsFailure('AccessDenied')]);
        expect(result.code).toBe(1);
        expect(operations(result)).not.toContain('put-bucket-policy');
    });

    test.each([policyReply(existing), missing, policyReply({ ...existing, Statement: build().Statement })])('readback mismatch or lost existing grants fails without a blind rollback: %j', (observed) => {
        const result = runUtility([...baseArgs, ...applyArgs], [identity, policyReply(existing), policyReply(existing), ok({}), observed]);
        expect(result.code).toBe(1);
        expect(operations(result).filter((operation) => operation === 'put-bucket-policy')).toHaveLength(1);
        expect(result.logs[1].action).toBe('verification-failed');
        expect(result.errors[0].message).toContain('No rollback attempted');
    });

    test('readback access failure reports unknown live state without a blind rollback', () => {
        const result = runUtility([...baseArgs, ...applyArgs], [identity, missing, missing, ok({}), awsFailure('AccessDenied')]);
        expect(result.code).toBe(1);
        expect(result.errors[0].message).toMatch(/Readback failed.*Mutation may be live.*No rollback attempted/);
        expect(operations(result).filter((operation) => operation === 'put-bucket-policy')).toHaveLength(1);
    });

    test('put failure reports uncertain outcome and stops before later buckets', () => {
        const result = runUtility([...baseArgs, ...applyArgs, '--bucket', 'another-policy-test'], [identity, missing, missing, awsFailure('AccessDenied', 'PutBucketPolicy')]);
        expect(result.code).toBe(1);
        expect(result.errors[0].message).toContain('Write outcome may be unknown');
        expect(result.errors[0].completedBuckets).toBe(0);
        expect(operations(result)).toHaveLength(4);
    });

    test('bootstrap merge file uses the same safe apply path without replacing unrelated grants', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's3-https-'));
        try {
            const file = path.join(dir, 'grant.json');
            const grant = { ...existing.Statement[0], Sid: 'PublicReadStaticWebsite' };
            fs.writeFileSync(file, JSON.stringify({ Version: '2012-10-17', Statement: [grant] }));
            const result = runUtility([...baseArgs, ...applyArgs, '--merge-policy', file], [identity, policyReply(existing), policyReply(existing), ok({}), { written: true }]);
            expect(result.code).toBe(0);
            expect(result.logs[1].observed.policy.Statement).toEqual([...existing.Statement, grant, build().Statement[0]]);
            fs.writeFileSync(file, JSON.stringify({ Id: 'would-be-lost', Statement: [grant] }));
            expect(runUtility([...baseArgs, '--merge-policy', file], []).code).toBe(1);
            fs.writeFileSync(file, 'broken JSON');
            expect(runUtility([...baseArgs, '--merge-policy', file], []).code).toBe(1);
            expect(runUtility([...baseArgs, '--merge-policy', file, '--bucket', 'another-policy-test'], []).calls).toEqual([]);
            expect(runUtility([...baseArgs, '--merge-policy', path.join(dir, 'missing.json')], []).code).toBe(1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('real CLI help and invalid apply exit before AWS is reachable', () => {
        const script = path.join(repoRoot, 'scripts/security/enforce-s3-https.mjs');
        const env = { ...process.env, PATH: '', AWS_EC2_METADATA_DISABLED: 'true' };
        const help = spawnSync(process.execPath, [script, '--help'], { env, encoding: 'utf8', shell: false, timeout: 15000 });
        expect(help.status).toBe(0);
        expect(help.stdout).toContain('Defaults to dry-run');
        const invalid = spawnSync(process.execPath, [script, ...baseArgs, '--apply'], { env, encoding: 'utf8', shell: false, timeout: 15000 });
        expect(invalid.status).toBe(1);
        expect(invalid.stderr).toContain('requires explicit --expected-bucket-owner');
    });

    test('all three bootstraps route policy changes through owner-checked append-only maintenance', () => {
        const files = ['bootstrap-free-tier.ps1', 'bootstrap-frontend-cloudfront.ps1', 'bootstrap-frontend-s3.ps1'];
        for (const name of files) {
            const source = fs.readFileSync(path.join(repoRoot, 'infra/aws', name), 'utf8');
            expect(source).toContain('enforce-s3-https.mjs');
            expect(source).toContain('--apply');
            expect(source).toContain('--expected-bucket-owner');
            expect(source).toContain('Require-Command -Name "node"');
            expect(source).not.toMatch(/aws s3api put-bucket-policy/);
        }
        for (const name of files.slice(1)) {
            const source = fs.readFileSync(path.join(repoRoot, 'infra/aws', name), 'utf8');
            expect(source).toContain('--merge-policy');
        }
    });
});
