import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

/**
 * Keeps the live Render static site in sync with the committed `render.yaml`.
 *
 * Why this exists: the production deploy job only PUTs env vars and starts a
 * build, so Render never re-reads the Blueprint. After a backend-origin swap
 * the committed `render.yaml` carried the new edge but the live service kept
 * serving the old one — stale security headers AND stale proxy routes, meaning
 * the retired CloudFront distribution stayed on the critical path for that lane.
 *
 * Render exposes exactly the two endpoints needed:
 *   PUT /v1/services/{id}/headers  replace all header rules
 *   PUT /v1/services/{id}/routes   replace all redirect/rewrite rules
 *
 * Both are full replacements, so a wrong payload would wipe live rules. This
 * script therefore:
 *   - is check-only unless --apply is passed,
 *   - backs up the live rules to a file before mutating anything,
 *   - re-reads and diffs after applying,
 *   - never invents values: the payload is parsed straight out of render.yaml.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const renderYamlPath = path.join(repoRoot, 'render.yaml');

const API_BASE = process.env.RENDER_API_HOST || 'https://api.render.com/v1';
const APPLY = process.argv.includes('--apply');
const BACKUP_DIR = path.join(repoRoot, 'output', 'render-edge-config');

const readEnv = (name) => String(process.env[name] || '').trim();

// A CloudFront distribution host is a single label under cloudfront.net.
const CLOUDFRONT_HOSTNAME_SUFFIX = '.cloudfront.net';

/**
 * True when `hostname` is a CloudFront distribution host.
 *
 * The label is compared as a string, not as a regular expression, so there is
 * no anchoring to get wrong: `\A` and `\z` are whole-string anchors in some
 * regex dialects but are plain identity escapes in JavaScript, where only
 * `^`/`$` (without the `m` flag) anchor the whole string.
 */
const isCloudfrontHostname = (hostname) => {
    if (!hostname.endsWith(CLOUDFRONT_HOSTNAME_SUFFIX)) return false;
    const label = hostname.slice(0, -CLOUDFRONT_HOSTNAME_SUFFIX.length);
    if (!label) return false;
    for (const character of label) {
        const isLowerCaseLetter = character >= 'a' && character <= 'z';
        const isDigit = character >= '0' && character <= '9';
        if (!isLowerCaseLetter && !isDigit) return false;
    }
    return true;
};

/**
 * Extracts the CloudFront origins a live Content-Security-Policy still names.
 *
 * The CSP value is a list of whitespace/semicolon separated source
 * expressions. Each candidate is PARSED and its hostname compared against the
 * CloudFront shape - never matched as a substring - because an unanchored
 * pattern also matches `https://x.cloudfront.net.attacker.example` and
 * `https://attacker.example/https://x.cloudfront.net`. Either one would make
 * this drift report name a CloudFront origin the edge does not actually
 * serve, which is exactly the signal this report exists to raise.
 */
const extractCloudfrontOrigins = (cspValue) => {
    const origins = [];
    for (const token of String(cspValue || '').split(/[\s;]+/)) {
        const lower = token.toLowerCase();
        if (!lower.startsWith('http://') && !lower.startsWith('https://')) continue;
        let hostname;
        try {
            hostname = new URL(token).hostname;
        } catch {
            continue;
        }
        if (isCloudfrontHostname(hostname)) {
            origins.push(`https://${hostname}`);
        }
    }
    return origins;
};

const request = async (method, endpoint, body) => {
    const apiKey = readEnv('RENDER_API_KEY');
    const response = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`${method} ${endpoint} -> HTTP ${response.status}: ${text.slice(0, 400)}`);
    }

    return text ? JSON.parse(text) : null;
};

const normalizeRoutes = (routes = []) => routes.map((entry) => {
    // Render returns either the rule inline or nested under `route`; tolerate both
    // rather than assuming, so a shape change shows up as drift instead of a crash.
    const rule = entry?.route && typeof entry.route === 'object' ? entry.route : entry || {};

    return {
        type: rule.type ?? '',
        source: rule.source ?? '',
        destination: rule.destination ?? '',
    };
});

const normalizeHeaders = (headers = []) => headers.map((entry) => {
    const rule = entry?.header && typeof entry.header === 'object' ? entry.header : entry || {};

    return {
        path: rule.path ?? rule.headerPath ?? '',
        name: String(rule.name ?? rule.header ?? ''),
        value: String(rule.value ?? ''),
    };
});

const describeShape = (entries = []) => (entries.length === 0
    ? '(empty)'
    : Object.keys(entries[0] || {}).sort().join(', '));

const sortForCompare = (entries, keys) => [...entries].sort((a, b) => {
    const left = keys.map((key) => String(a[key] ?? '')).join(' ');
    const right = keys.map((key) => String(b[key] ?? '')).join(' ');

    return left.localeCompare(right);
});

const readCommitted = async () => {
    const parsed = yaml.load(await readFile(renderYamlPath, 'utf8'));
    const service = (parsed.services || []).find((entry) => entry.name === 'aura-storefront') || parsed.services?.[0];

    if (!service) {
        throw new Error(`No service block found in ${renderYamlPath}.`);
    }

    return {
        routes: normalizeRoutes(service.routes || []),
        headers: normalizeHeaders(service.headers || []),
    };
};

const main = async () => {
    const apiKey = readEnv('RENDER_API_KEY');
    const serviceId = readEnv('RENDER_SERVICE_ID');

    if (!apiKey) {
        throw new Error('RENDER_API_KEY is required.');
    }
    if (!serviceId) {
        throw new Error('RENDER_SERVICE_ID is required.');
    }

    const committed = await readCommitted();
    const rawRoutes = await request('GET', `/services/${serviceId}/routes`);
    const rawHeaders = await request('GET', `/services/${serviceId}/headers`);
    const liveRoutes = normalizeRoutes(Array.isArray(rawRoutes) ? rawRoutes : []);
    const liveHeaders = normalizeHeaders(Array.isArray(rawHeaders) ? rawHeaders : []);

    const routesMatch = JSON.stringify(sortForCompare(committed.routes, ['source', 'destination']))
        === JSON.stringify(sortForCompare(liveRoutes, ['source', 'destination']));
    const headersMatch = JSON.stringify(sortForCompare(committed.headers, ['path', 'name']))
        === JSON.stringify(sortForCompare(liveHeaders, ['path', 'name']));

    console.log(`Render service ${serviceId}`);
    console.log(`  committed routes : ${committed.routes.length}`);
    console.log(`  live routes      : ${liveRoutes.length}  ${routesMatch ? '(in sync)' : '(DRIFT)'}`);
    console.log(`  committed headers: ${committed.headers.length}`);
    console.log(`  live headers     : ${liveHeaders.length}  ${headersMatch ? '(in sync)' : '(DRIFT)'}`);
    console.log(`  live route keys  : ${describeShape(Array.isArray(rawRoutes) ? rawRoutes : [])}`);
    console.log(`  live header keys : ${describeShape(Array.isArray(rawHeaders) ? rawHeaders : [])}`);
    console.log('');

    if (!routesMatch) {
        console.log('Route drift (committed vs live):');
        for (const route of committed.routes) {
            const live = liveRoutes.some((entry) => entry.source === route.source);

            console.log(`  ${live ? '   ' : '>> '} ${route.type.padEnd(8)} ${route.source} -> ${route.destination}`);
        }
        for (const route of liveRoutes) {
            if (!committed.routes.some((entry) => entry.source === route.source)) {
                console.log(`  <<  REMOVED  ${route.source} -> ${route.destination}`);
            }
        }
        console.log('');
    }

    if (!routesMatch || !headersMatch) {
        const liveOrigins = [...new Set(
            liveHeaders
                .filter(({ name }) => name.toLowerCase() === 'content-security-policy')
                .flatMap(({ value }) => extractCloudfrontOrigins(value)),
        )];

        if (liveOrigins.length > 0) {
            console.log(`Live Content-Security-Policy still names: ${liveOrigins.join(', ')}`);
            console.log('');
        }
    }

    if (routesMatch && headersMatch) {
        console.log(APPLY ? 'Already in sync; nothing to apply.' : 'render.yaml matches the live Render service.');
        return;
    }

    if (!APPLY) {
        console.log('Drift detected. Re-run with --apply to push render.yaml to the live service.');
        process.exitCode = 1;
        return;
    }

    await mkdir(BACKUP_DIR, { recursive: true });
    const backupPath = path.join(BACKUP_DIR, `live-routes-headers-${serviceId}.json`);
    await writeFile(backupPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), routes: liveRoutes, headers: liveHeaders }, null, 4)}\n`, 'utf8');
    console.log(`Backed up live rules to ${path.relative(repoRoot, backupPath)}`);

    await request('PUT', `/services/${serviceId}/routes`, committed.routes);
    console.log(`PUT routes   (${committed.routes.length} rules)`);
    await request('PUT', `/services/${serviceId}/headers`, committed.headers);
    console.log(`PUT headers  (${committed.headers.length} rules)`);

    const afterRoutes = normalizeRoutes(await request('GET', `/services/${serviceId}/routes`));
    const afterHeaders = normalizeHeaders(await request('GET', `/services/${serviceId}/headers`));
    const routesOk = JSON.stringify(sortForCompare(committed.routes, ['source', 'destination']))
        === JSON.stringify(sortForCompare(afterRoutes, ['source', 'destination']));
    const headersOk = JSON.stringify(sortForCompare(committed.headers, ['path', 'name']))
        === JSON.stringify(sortForCompare(afterHeaders, ['path', 'name']));

    console.log('');
    console.log(`Verify: routes ${routesOk ? 'in sync' : 'STILL DRIFTED'}, headers ${headersOk ? 'in sync' : 'STILL DRIFTED'}`);

    if (!routesOk || !headersOk) {
        process.exitCode = 1;
    }
};

await main();