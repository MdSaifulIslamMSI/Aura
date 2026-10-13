#!/usr/bin/env node
// Read-only parity report: live /aura/prod SSM parameters vs the runtime
// contract (server/config/ssm-parameter-keys.cjs) and the full-path render
// path (infra/aws/docker-compose.ec2.yml env_file -> runtime-secrets.env).
//
// Classifies every live parameter as:
//   runtime-fetched      - in DEFAULT_AWS_PARAMETER_KEYS (GetParameters by name)
//   compose-env-rendered - reaches the container via the rendered
//                          runtime-secrets.env (get-parameters-by-path)
//   unclassified         - neither surface references it (triage needed)
// And reports runtime keys with no live parameter (boot-time gap).
//
// Requires AWS credentials with ssm:GetParametersByPath on /aura/prod.
// Report-only: makes no changes. Exit 0 always (triage tool, not a gate).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { createRequire } from 'node:module';
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const { DEFAULT_AWS_PARAMETER_KEYS } = createRequire(import.meta.url)('../../server/config/ssm-parameter-keys.cjs');

const PREFIX = process.env.AURA_PARAMETER_STORE_PATH_PREFIX
    || process.env.AWS_PARAMETER_STORE_PATH_PREFIX
    || '/aura/prod';
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-south-1';

const fail = (message) => {
    process.stderr.write(`ssm-parity-report: ${message}\n`);
    process.exit(1);
};

const listAllParameters = async () => {
    const { SSMClient, GetParametersByPathCommand } = serverRequire('@aws-sdk/client-ssm');
    const client = new SSMClient({ region: REGION });
    const names = [];
    let nextToken;
    for (;;) {
        const response = await client.send(new GetParametersByPathCommand({
            Path: PREFIX,
            Recursive: true,
            MaxResults: 10,
            NextToken: nextToken,
        }));
        for (const p of response.Parameters || []) names.push(p.Name);
        if (!response.NextToken) break;
        nextToken = response.NextToken;
    }
    return names;
};

const composeEnvPath = path.join(__dirname, '..', '..', 'infra', 'aws', 'docker-compose.ec2.yml');

const main = async () => {
    let live;
    try {
        live = await listAllParameters();
    } catch (error) {
        fail(`could not list ${PREFIX}: ${error.message}`);
    }
    const liveNames = new Set(live.map((name) => name.split('/').pop()));
    const liveKeys = [...liveNames].sort();

    const runtimeKeys = new Set(DEFAULT_AWS_PARAMETER_KEYS);

    // Full-path render surface: parameters injected wholesale into the
    // container via runtime-secrets.env (docker-compose env_file). Any live
    // parameter is visible to the container through that path, so this class
    // is "rendered" even when runtimeConfig never fetches it by name.
    let composeMentionsRuntimeConfig = false;
    try {
        composeMentionsRuntimeConfig = fs
            .readFileSync(composeEnvPath, 'utf8')
            .includes('runtime-secrets.env');
    } catch {
        // repo checkout without infra/ — treat as rendered (the EC2 host always does)
        composeMentionsRuntimeConfig = true;
    }

    const runtimeFetched = liveKeys.filter((key) => runtimeKeys.has(key));
    const renderedOnly = liveKeys.filter((key) => !runtimeKeys.has(key));
    const missingFromLive = [...runtimeKeys].filter((key) => !liveNames.has(key)).sort();

    const report = {
        generatedAt: new Date().toISOString(),
        prefix: PREFIX,
        region: REGION,
        liveParameterCount: live.length,
        runtimeContractCount: runtimeKeys.size,
        runtimeFetched,
        renderedOnly: composeMentionsRuntimeConfig
            ? { note: 'all rendered-only params reach the container via runtime-secrets.env', keys: renderedOnly }
            : { note: 'compose env_file surface not found — renderedOnly params may be orphans', keys: renderedOnly },
        missingFromLive,
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    const knownConstructed = ['FIELD_ENCRYPTION_WRAPPED_DEK'];
    const unclassified = renderedOnly.filter((key) => !knownConstructed.includes(key));
    if (unclassified.length) {
        process.stderr.write(`\n[note] ${unclassified.length} live parameter(s) are not in the runtime fetch list:\n`);
        for (const key of unclassified) process.stderr.write(`  - ${PREFIX}/${key}\n`);
        process.stderr.write('These reach the container via the rendered runtime-secrets.env path.\n');
    }
    if (missingFromLive.length) {
        process.stderr.write(`\n[warn] ${missingFromLive.length} runtime contract key(s) have NO live parameter:\n`);
        for (const key of missingFromLive) process.stderr.write(`  - ${PREFIX}/${key}\n`);
        process.stderr.write('The app boots via fallbacks for these; create them in SSM or remove from the contract.\n');
    }
};

main().then(
    () => process.exit(0),
    (error) => {
        fail(error.message);
    }
);
