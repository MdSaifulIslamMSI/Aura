#!/usr/bin/env node
'use strict';

/**
 * OpenFGA authorization live verification. Assumes a running OpenFGA server
 * (default http://127.0.0.1:8080 — see infra/security/openfga/docker-compose.yml).
 *
 * Creates a throwaway store, loads infra/security/openfga/authorization-model.json,
 * writes tuples through server/services/authorization/openFgaService.js, and
 * asserts the authorization decisions end to end. Deletes the store on exit.
 *
 * Usage: node scripts/security/openfga-verification.mjs [--api-url http://127.0.0.1:8080]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const args = process.argv.slice(2);
const apiUrl = (args.includes('--api-url') ? args[args.indexOf('--api-url') + 1] : 'http://127.0.0.1:8080').replace(/\/$/, '');

const { createOpenFgaService } = require(path.join(repoRoot, 'server', 'services', 'authorization', 'openFgaService.js'));

const model = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'infra', 'security', 'openfga', 'authorization-model.json'),
    'utf8'
));

let failures = 0;
const record = (name, ok, detail = '') => {
    if (!ok) failures += 1;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const api = async (method, urlPath, body) => {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}${urlPath}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${urlPath} -> ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`);
    return payload;
};

const main = async () => {
    console.log(`[openfga-verify] using OpenFGA at ${apiUrl}`);

    const store = await api('POST', '/stores', { name: `aura-verify-${Date.now()}` });
    const storeId = store.id;
    console.log(`[openfga-verify] store created: ${storeId}`);

    const modelResponse = await api('POST', `/stores/${storeId}/authorization-models`, model);
    const modelId = modelResponse.authorization_model_id;
    console.log(`[openfga-verify] model written: ${modelId}`);

    const service = createOpenFgaService({
        apiUrl,
        storeId,
        authorizationModelId: modelId,
        enforcementMode: 'enforce',
        timeoutMs: 5000,
    });

    const write = await service.writeTuples([
        { user: 'user:owner-1', relation: 'owner', object: 'listing:listing-1' },
        { user: 'user:admin-1', relation: 'admin', object: 'listing:listing-1' },
    ]);
    if (write.written !== 2) throw new Error('tuple write failed');
    console.log('[openfga-verify] tuples written: 2');

    const cases = [
        { name: 'owner has editor relation', userId: 'owner-1', legacy: true, expected: true },
        { name: 'admin has editor relation (FGA grant beyond legacy)', userId: 'admin-1', legacy: false, expected: true },
        { name: 'unrelated user is denied', userId: 'random-1', legacy: true, expected: false },
    ];
    for (const testCase of cases) {
        const decision = await service.authorizeListingEditor({
            userId: testCase.userId,
            listingId: 'listing-1',
            legacyAllowed: testCase.legacy,
        });
        record(testCase.name, decision.allowed === testCase.expected, `allowed=${decision.allowed} mode=${decision.mode}`);
    }

    // The model must reject relations it does not know about.
    const unknownRelation = await service.checkRelation({ userId: 'owner-1', relation: 'viewer', object: 'listing:listing-1' }).catch(() => null);
    record('model rejects undeclared relations', unknownRelation === null || unknownRelation === false, `result=${unknownRelation}`);

    await api('DELETE', `/stores/${storeId}`).catch(() => {});
    console.log(`[openfga-verify] ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURES`}. Store deleted.`);
    process.exitCode = failures === 0 ? 0 : 1;
};

main().catch((error) => {
    console.error(`[openfga-verify] ${error.message}`);
    process.exitCode = 1;
});
