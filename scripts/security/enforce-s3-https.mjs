#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SID = 'DenyInsecureTransport';
const POLICY_LIMIT = 20480;
const USAGE = `Usage: node scripts/security/enforce-s3-https.mjs --region REGION [--profile PROFILE]
  --bucket NAME [--bucket NAME ...] [--expected-bucket-owner ACCOUNT_ID] [--dry-run | --apply]
  [--merge-policy FILE]
Defaults to dry-run (AWS reads only). Apply requires an explicit expected owner,
which must also match the caller account. Only s3api put-bucket-policy can mutate AWS.
--merge-policy appends named bootstrap statements, never replaces them; one bucket only.
Output is JSON Lines: before/planned/observed policy data and SHA-256 audit evidence.
S3 has no conditional policy writes: serialize operators; the pre-write reread is not a lock.`;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stableJson = (value) => {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (isObject(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};
const snapshot = (policy) => ({
    policy,
    sha256: createHash('sha256').update(stableJson(policy)).digest('hex'),
});

function validateBucket(bucket) {
    if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
        || /\.\.|\.-|-\.|^(\d{1,3}\.){3}\d{1,3}$/.test(bucket)) {
        throw new Error('Invalid S3 bucket name (use a bucket name, not an ARN or URL).');
    }
}

function policyStatements(policy) {
    if (!isObject(policy) || (policy.Version !== undefined
        && !['2008-10-17', '2012-10-17'].includes(policy.Version))) {
        throw new Error('Invalid bucket policy document or Version.');
    }
    const statements = Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement];
    if (!statements.every(isObject)) throw new Error('Invalid bucket policy Statement.');
    return statements;
}

// Append only: even a conflicting statement owned by this tool needs operator review.
export function buildHttpsPolicy(bucket, currentPolicy = null, { additionalStatements = [], partition = 'aws' } = {}) {
    validateBucket(bucket);
    if (!['aws', 'aws-cn', 'aws-us-gov'].includes(partition)) throw new Error('Unsupported AWS partition.');
    const policy = currentPolicy === null ? { Version: '2012-10-17', Statement: [] } : structuredClone(currentPolicy);
    const existing = policyStatements(policy);
    const statements = [...existing];
    if (!Array.isArray(additionalStatements)) throw new Error('Additional statements must be an array.');
    const arn = `arn:${partition}:s3:::${bucket}`;
    const deny = {
        Sid: SID,
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: [arn, `${arn}/*`],
        Condition: {
            Bool: {
                'aws:SecureTransport': 'false',
                // AWS service-to-service requests can have network metadata redacted.
                'aws:PrincipalIsAWSService': 'false',
            },
        },
    };
    for (const statement of [...additionalStatements, deny]) {
        if (!isObject(statement) || typeof statement.Sid !== 'string' || !/^[A-Za-z0-9]+$/.test(statement.Sid)) {
            throw new Error('Appended statements require a nonempty alphanumeric Sid.');
        }
        const matches = statements.filter((item) => item.Sid === statement.Sid);
        if (matches.length > 1 || (matches.length === 1 && stableJson(matches[0]) !== stableJson(statement))) {
            throw new Error(`SID collision: ${statement.Sid}; refusing to replace existing statements.`);
        }
        if (matches.length === 0) statements.push(structuredClone(statement));
    }
    // Preserve even the singleton Statement representation on an already-compliant policy.
    if (statements.length !== existing.length) policy.Statement = statements;
    if (Buffer.byteLength(JSON.stringify(policy), 'utf8') > POLICY_LIMIT) throw new Error('Result exceeds the S3 bucket policy size limit.');
    return policy;
}

function parseArgs(argv) {
    const options = { buckets: [], apply: false };
    const valueFlags = new Map([
        ['--region', 'region'], ['--profile', 'profile'], ['--expected-bucket-owner', 'owner'], ['--merge-policy', 'mergePolicy'],
    ]);
    let mode;
    for (let i = 0; i < argv.length; i += 1) {
        const flag = argv[i];
        if (flag === '--help') {
            if (argv.length !== 1) throw new Error('--help must be used alone.');
            return { help: true };
        }
        if (flag === '--apply' || flag === '--dry-run') {
            if (mode) throw new Error('Specify only one of --apply or --dry-run.');
            mode = flag;
            options.apply = flag === '--apply';
            continue;
        }
        if (flag !== '--bucket' && !valueFlags.has(flag)) throw new Error('Unknown argument; use --help.');
        const value = argv[++i];
        if (!value || value.startsWith('-')) throw new Error(`Missing value for ${flag}.`);
        if (flag === '--bucket') options.buckets.push(value);
        else {
            const key = valueFlags.get(flag);
            if (options[key] !== undefined) throw new Error(`Duplicate ${flag}.`);
            options[key] = value;
        }
    }
    options.buckets = [...new Set(options.buckets)];
    if (options.buckets.length === 0) throw new Error('At least one --bucket is required.');
    options.buckets.forEach(validateBucket);
    if (!options.region || !/^[a-z]{2,}(?:-[a-z]+)+-\d+$/.test(options.region)) throw new Error('A valid --region is required.');
    if (options.profile !== undefined && !/^[A-Za-z0-9_@.+-]+$/.test(options.profile)) throw new Error('Invalid --profile.');
    if (options.owner !== undefined && !/^\d{12}$/.test(options.owner)) throw new Error('--expected-bucket-owner must be a 12-digit account ID.');
    if (options.apply && !options.owner) throw new Error('--apply requires explicit --expected-bucket-owner.');
    if (options.mergePolicy && options.buckets.length !== 1) throw new Error('--merge-policy requires exactly one bucket.');
    return options;
}

function parseJson(text, label) {
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Invalid JSON from ${label}; refusing to continue.`);
    }
}

export function main(argv, { spawn = spawnSync, log = console.log, error = console.error } = {}) {
    let completed = 0;
    let activeBucket;
    try {
        const options = parseArgs(argv);
        if (options.help) {
            log(USAGE);
            return 0;
        }
        const mode = options.apply ? 'apply' : 'dry-run';
        const emit = (event) => log(JSON.stringify({ mode, ...event }));
        let additionalStatements = [];
        if (options.mergePolicy) {
            let text;
            try {
                text = readFileSync(options.mergePolicy, 'utf8');
            } catch {
                throw new Error('Cannot read --merge-policy file.');
            }
            const additions = parseJson(text, '--merge-policy');
            additionalStatements = policyStatements(additions);
            if (Object.keys(additions).some((key) => !['Version', 'Statement'].includes(key))) {
                throw new Error('--merge-policy accepts only Version and Statement; no policy metadata is replaced.');
            }
        }
        const globalArgs = ['--region', options.region, '--output', 'json', '--no-cli-pager',
            '--cli-connect-timeout', '10', '--cli-read-timeout', '20'];
        if (options.profile) globalArgs.push('--profile', options.profile);
        const aws = (service, operation, args = []) => {
            const result = spawn('aws', [service, operation, ...args, ...globalArgs], {
                shell: false,
                windowsHide: true,
                encoding: 'utf8',
                timeout: 30000,
                maxBuffer: 1024 * 1024,
                env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off', AWS_MAX_ATTEMPTS: '2' },
            });
            if (result.error || result.signal || result.status !== 0) {
                // Never echo raw CLI output/errors: credential helpers may include secrets.
                const match = /An error occurred \(([A-Za-z0-9]+)\) when calling the ([A-Za-z0-9]+) operation/.exec(result.stderr || '');
                const processCode = /^[A-Z0-9_]+$/.test(result.error?.code || '') ? result.error.code : 'ProcessFailure';
                const code = result.error || result.signal ? processCode : (match?.[1] || 'CliFailure');
                const failure = new Error(`AWS ${service} ${operation} failed (${code}); no raw CLI output logged.`);
                failure.noPolicy = code === 'NoSuchBucketPolicy' && match?.[2] === 'GetBucketPolicy';
                throw failure;
            }
            return result.stdout;
        };
        const identity = parseJson(aws('sts', 'get-caller-identity'), 'STS identity');
        if (!/^\d{12}$/.test(identity?.Account || '')) throw new Error('Invalid caller account.');
        if (options.owner && identity.Account !== options.owner) throw new Error('Caller account does not match --expected-bucket-owner.');
        const partition = /^arn:(aws|aws-cn|aws-us-gov):/.exec(identity.Arn || '')?.[1];
        if (!partition) throw new Error('Cannot determine AWS partition from caller identity.');
        for (const bucket of options.buckets) {
            activeBucket = bucket;
            const args = ['--bucket', bucket];
            if (options.owner) args.push('--expected-bucket-owner', options.owner);
            const readPolicy = () => {
                let text;
                try {
                    text = aws('s3api', 'get-bucket-policy', args);
                } catch (failure) {
                    if (failure.noPolicy) return null;
                    throw failure;
                }
                const envelope = parseJson(text, 'get-bucket-policy');
                if (typeof envelope?.Policy !== 'string') throw new Error('Missing Policy in get-bucket-policy response.');
                const policy = parseJson(envelope.Policy, 'bucket policy');
                policyStatements(policy);
                return policy;
            };
            const before = readPolicy();
            const after = buildHttpsPolicy(bucket, before, { additionalStatements, partition });
            const changed = stableJson(before) !== stableJson(after);
            emit({ bucket, action: changed ? 'planned' : 'unchanged', callerAccount: identity.Account,
                expectedOwner: options.owner || null, ownerVerified: Boolean(options.owner), before: snapshot(before), after: snapshot(after) });
            if (options.apply && changed) {
                const latest = readPolicy();
                if (stableJson(latest) !== stableJson(before)) {
                    emit({ bucket, action: 'concurrent-change', observed: snapshot(latest) });
                    throw new Error('Policy changed since planning; no write attempted for this bucket. Rerun for review.');
                }
                // S3 has no If-Match for policies. This narrows, but cannot close, the write race.
                try {
                    aws('s3api', 'put-bucket-policy', [...args, '--policy', JSON.stringify(after)]);
                } catch (failure) {
                    throw new Error(`${failure.message} Write outcome may be unknown; inspect current policy. No rollback attempted.`);
                }
                let observed;
                try {
                    observed = readPolicy();
                } catch (failure) {
                    throw new Error(`Readback failed after write: ${failure.message} Mutation may be live. No rollback attempted.`);
                }
                const verified = stableJson(observed) === stableJson(after);
                emit({ bucket, action: verified ? 'verified' : 'verification-failed', observed: snapshot(observed) });
                if (!verified) throw new Error('Policy readback mismatch; mutation may be live. No rollback attempted.');
            }
            completed += 1;
        }
        emit({ action: 'summary', completedBuckets: completed, requestedBuckets: options.buckets.length, status: 'ok' });
        return 0;
    } catch (failure) {
        error(JSON.stringify({ action: 'failed', bucket: activeBucket, completedBuckets: completed, message: failure.message }));
        return 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
