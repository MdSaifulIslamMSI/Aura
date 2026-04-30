#!/usr/bin/env node

import { resolveHostedBackendOrigin } from '../config/vercelRoutingContract.mjs';

const DEFAULT_TIMEOUT_MS = 5000;

const parseArgs = (argv = []) => {
    const options = {
        origin: '',
        timeoutMs: DEFAULT_TIMEOUT_MS,
        json: false,
        skipCatalog: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--json') {
            options.json = true;
            continue;
        }
        if (arg === '--skip-catalog') {
            options.skipCatalog = true;
            continue;
        }
        if (arg === '--origin') {
            options.origin = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (arg.startsWith('--origin=')) {
            options.origin = arg.slice('--origin='.length).trim();
            continue;
        }
        if (arg === '--timeout-ms') {
            options.timeoutMs = Number(argv[index + 1] || DEFAULT_TIMEOUT_MS);
            index += 1;
            continue;
        }
        if (arg.startsWith('--timeout-ms=')) {
            options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
        }
    }

    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        options.timeoutMs = DEFAULT_TIMEOUT_MS;
    }

    return options;
};

const usage = () => `Backend connectivity doctor

Usage:
  node app/scripts/check_backend_connectivity.mjs [--origin URL] [--timeout-ms 5000] [--json] [--skip-catalog]

Environment origin fallback order:
  AURA_BACKEND_ORIGIN, AWS_BACKEND_BASE_URL, checked-in hosted backend origin
`;

const buildEndpoints = ({ skipCatalog = false } = {}) => [
    { name: 'liveness', path: '/health/live', critical: true },
    { name: 'readiness', path: '/health/ready', critical: true },
    { name: 'deep health', path: '/health', critical: false },
    ...(skipCatalog ? [] : [
        { name: 'catalog smoke', path: '/api/products?limit=1', critical: false },
    ]),
];

const parseBody = (text = '') => {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text.slice(0, 500);
    }
};

const probeEndpoint = async ({ origin, endpoint, timeoutMs }) => {
    const url = new URL(endpoint.path, `${origin}/`).toString();
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
            cache: 'no-store',
        });
        const text = await response.text();
        const durationMs = Date.now() - startedAt;

        return {
            ...endpoint,
            url,
            ok: response.ok,
            status: response.status,
            durationMs,
            payload: parseBody(text),
        };
    } catch (error) {
        const durationMs = Date.now() - startedAt;
        const timedOut = error?.name === 'AbortError';

        return {
            ...endpoint,
            url,
            ok: false,
            status: 0,
            durationMs,
            error: timedOut
                ? `timed out after ${timeoutMs}ms`
                : (error?.message || 'request failed'),
        };
    } finally {
        clearTimeout(timeout);
    }
};

const summarizePayload = (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return '';
    }

    const parts = [];
    if (payload.status) parts.push(`status=${payload.status}`);
    if (payload.ready !== undefined) parts.push(`ready=${payload.ready}`);
    if (payload.reason) parts.push(`reason=${payload.reason}`);
    if (payload.db) parts.push(`db=${payload.db}`);
    if (payload.redis?.connected !== undefined) parts.push(`redis=${payload.redis.connected}`);
    if (payload.topology?.splitRuntimeReady !== undefined) {
        parts.push(`splitRuntimeReady=${payload.topology.splitRuntimeReady}`);
    }

    return parts.length ? ` (${parts.join(', ')})` : '';
};

const main = async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(usage());
        return 0;
    }

    const origin = options.origin
        ? resolveHostedBackendOrigin({ AURA_BACKEND_ORIGIN: options.origin })
        : resolveHostedBackendOrigin();

    const results = [];
    for (const endpoint of buildEndpoints(options)) {
        results.push(await probeEndpoint({
            origin,
            endpoint,
            timeoutMs: options.timeoutMs,
        }));
    }

    const failedCritical = results.filter((result) => result.critical && !result.ok);
    const exitCode = failedCritical.length > 0 ? 1 : 0;

    if (options.json) {
        process.stdout.write(`${JSON.stringify({ origin, ok: exitCode === 0, results }, null, 2)}\n`);
        return exitCode;
    }

    process.stdout.write(`Backend origin: ${origin}\n`);
    for (const result of results) {
        const marker = result.ok ? 'PASS' : (result.critical ? 'FAIL' : 'WARN');
        const status = result.status ? `HTTP ${result.status}` : result.error;
        process.stdout.write(`${marker} ${result.name}: ${status} in ${result.durationMs}ms${summarizePayload(result.payload)}\n`);
    }

    if (exitCode !== 0) {
        process.stdout.write('Critical backend connectivity failed. Check the EC2 instance, Caddy edge on ports 80/443, backend process, and deployed origin.\n');
    }

    return exitCode;
};

main()
    .then((exitCode) => {
        process.exitCode = exitCode;
    })
    .catch((error) => {
        process.stderr.write(`${error?.message || error}\n`);
        process.exitCode = 1;
    });
