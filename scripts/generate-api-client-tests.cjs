/**
 * Generates route-contract test suites for app/src/services/api clients.
 *
 * For every exported client object in each module, extracts the first apiFetch
 * call (path template + HTTP method) of each method and emits a test asserting
 * the request contract (path segments, HTTP verb, auth header presence).
 *
 * Idempotent: regenerates *.route.test.js files.
 * Usage:
 *   node scripts/generate-api-client-tests.cjs                # all modules
 *   node scripts/generate-api-client-tests.cjs cartApi.js     # one module
 */
const fs = require('fs');
const path = require('path');

const API_DIR = path.resolve(__dirname, '..', 'app', 'src', 'services', 'api');
const TARGETS = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readdirSync(API_DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'index.js' && f !== 'apiUtils.js');

// Extract every `export const <name> = { ... }` object with balanced braces.
function extractClients(source) {
    const clients = [];
    const clientRe = /export const (\w+) = \{/g;
    let m;
    while ((m = clientRe.exec(source)) !== null) {
        const name = m[1];
        const start = m.index + m[0].length;
        let depth = 1;
        let i = start;
        while (i < source.length && depth > 0) {
            const ch = source[i];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            i += 1;
        }
        clients.push({ name, body: source.slice(start, i - 1) });
    }
    return clients;
}

// Skip over a quoted string starting at `start` (the quote char), handling
// escapes and template-literal ${...} interpolations.
function skipString(source, start) {
    const quote = source[start];
    let i = start + 1;
    let interpolationDepth = 0;
    while (i < source.length) {
        const ch = source[i];
        if (ch === '\\') { i += 2; continue; }
        if (quote === '`' && ch === '$' && source[i + 1] === '{') { interpolationDepth += 1; i += 2; continue; }
        if (quote === '`' && interpolationDepth > 0 && ch === '}') { interpolationDepth -= 1; i += 1; continue; }
        if (ch === quote && interpolationDepth === 0) return i + 1;
        i += 1;
    }
    return i;
}

// Extract the path and HTTP method of the first apiFetch call at or after
// `from`. Both are read strictly from the call's own argument list
// (paren-depth bounded), so a GET without options can never inherit the next
// call's `method: 'POST'`.
function extractFirstApiFetch(body, from) {
    const idx = body.indexOf('apiFetch(', from);
    if (idx === -1) return null;
    const after = body.slice(idx + 'apiFetch('.length);
    const quote = after[0];
    if (quote !== '\'' && quote !== '`') return null;

    const pathEnd = skipString(after, 0);
    const rawPath = after.slice(1, pathEnd - 1);

    let depth = 1;
    let j = pathEnd;
    while (j < after.length && depth > 0) {
        const ch = after[j];
        if (ch === '\'' || ch === '"' || ch === '`') { j = skipString(after, j); continue; }
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        j += 1;
    }
    const callArgs = after.slice(pathEnd, j - 1);
    const methodMatch = callArgs.match(/method:\s*'([A-Z]+)'/);
    return { rawPath, method: methodMatch ? methodMatch[1] : 'GET' };
}

function extractMethods(body) {
    const methods = [];
    const methodRe = /(?:^|[;\n])\s*(\w+):\s*async\s*(\([^)]*\))?\s*=>/g;
    const matches = [];
    let m;
    while ((m = methodRe.exec(body)) !== null) matches.push(m);
    for (let i = 0; i < matches.length; i += 1) {
        const start = matches[i].index;
        // A method can only claim an apiFetch inside its own body window.
        const windowEnd = i + 1 < matches.length ? matches[i + 1].index : body.length;
        const fetchIdx = body.indexOf('apiFetch(', start);
        if (fetchIdx === -1 || fetchIdx >= windowEnd) continue;
        const call = extractFirstApiFetch(body, start);
        if (!call) continue;
        const usesAuthHeader = body.slice(start, fetchIdx).includes('getAuthHeader');
        methods.push({ name: matches[i][1], usesAuthHeader, ...call });
    }
    return methods;
}

// Path segments outside ${...} interpolations, in order. The interpolation
// pattern tolerates one level of nested braces,
// e.g. `/orders${buildQueryString({ limit })}`.
function pathSegments(rawPath) {
    return rawPath
        .split(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g)
        .map((s) => s.trim())
        .filter(Boolean);
}

// Static-analysis escape hatch. Route contracts are extracted from the first
// apiFetch call in a method body, which is wrong for a few methods where the
// first call is conditional, the method validates input before calling, or
// the first network call is not the contract. Every entry must carry a
// `reason` that is emitted into the generated suite as a comment.
//
//  - route: override the extracted { rawPath, method }
//  - args:  JS expression string used as the call argument
//  - preNetworkFailure: assert the method rejects WITHOUT touching apiFetch
const METHOD_OVERRIDES = {
    'authApi.js': {
        sendOtp: {
            route: { rawPath: '/auth/otp/send', method: 'POST' },
            reason: 'First source call is the env-conditional PoW /otp/challenge probe; in NODE_ENV=test sendOtp posts directly to the first candidate path.',
        },
    },
    'i18nApi.js': {
        translateTexts: {
            args: "{ texts: ['hello'], language: 'fr' }",
            reason: 'Method de-duplicates `texts` and returns early (no apiFetch) when the list is empty, so placeholder args never reach the network.',
        },
    },
    'uploadApi.js': {
        uploadSignedReviewMedia: {
            preNetworkFailure: true,
            reason: 'Method converts `file` to a data URL via FileReader before any network call; a static test can only assert the fast-fail path.',
        },
    },
};

function render(fileName, clients) {
    const moduleBase = fileName.replace(/\.js$/, '');
    const clientNames = clients.map((c) => c.name);
    const totalMethods = clients.reduce((n, c) => n + c.methods.length, 0);
    if (totalMethods === 0) return null;

    const lines = [];
    lines.push(`// AUTO-GENERATED route-contract suite for ${fileName} — do not edit by hand.`);
    lines.push(`// Regenerate with: node scripts/generate-api-client-tests.cjs ${fileName}`);
    lines.push(`import { describe, expect, it, vi, beforeEach } from 'vitest';`);
    lines.push(``);
    lines.push(`vi.mock('../apiBase', () => ({`);
    lines.push(`    apiFetch: vi.fn(async () => ({ data: {} })),`);
    lines.push(`    buildApiUrl: vi.fn((p) => \`/api\${p}\`),`);
    lines.push(`    buildServiceUrl: vi.fn((p) => \`http://service.local\${p}\`),`);
    lines.push(`    API_BASE_URL: '/api',`);
    lines.push(`    SERVICE_BASE_URL: 'http://service.local',`);
    lines.push(`    parseJsonSafely: vi.fn(async () => ({})),`);
    lines.push(`    createResponseError: vi.fn(async (message) => new Error(message)),`);
    lines.push(`}));`);
    lines.push(`vi.mock('./apiUtils', () => ({`);
    lines.push(`    getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer test' })),`);
    lines.push(`    createIdempotencyKey: vi.fn((prefix) => \`\${prefix}-test\`),`);
    lines.push(`    runWhenIdle: vi.fn((callback) => { callback(); }),`);
    lines.push(`    parseApiError: vi.fn(async (message) => message),`);
    lines.push(`    PROFILE_CACHE_TTL_MS: 15000,`);
    lines.push(`    PRODUCT_DETAIL_CACHE_TTL_MS: 30000,`);
    lines.push(`    AUTH_TOKEN_TIMEOUT_MS: 5000,`);
    lines.push(`}));`);
    lines.push(``);
    lines.push(`import { apiFetch } from '../apiBase';`);
    lines.push(`import { ${clientNames.join(', ')} } from './${moduleBase}';`);
    lines.push(``);
    lines.push(`// Symbol-safe passthrough args: template-literal conversion, property`);
    lines.push(`// access, and calls all degrade to deterministic placeholder strings.`);
    lines.push(`const anyArgs = new Proxy(function placeholder() {}, {`);
    lines.push(`    get: (target, key) => {`);
    lines.push(`        if (typeof key === 'symbol') return () => String(key.description || '');`);
    lines.push(`        if (key === 'toString' || key === 'valueOf') return () => key;`);
    lines.push(`        return String(key);`);
    lines.push(`    },`);
    lines.push(`    apply: () => 'arg',`);
    lines.push(`});`);
    lines.push(``);
    lines.push(`beforeEach(() => {`);
    lines.push(`    apiFetch.mockClear();`);
    lines.push(`});`);
    lines.push(``);
    for (const client of clients) {
        if (client.methods.length === 0) continue;
        lines.push(`describe('${client.name} route contract', () => {`);
        for (const m of client.methods) {
            if (m.reason) {
                lines.push(`    // Override: ${m.reason}`);
            }
            if (m.preNetworkFailure) {
                const testName = JSON.stringify(`${m.name} fails fast without network for static placeholder input`);
                lines.push(`    it(${testName}, async () => {`);
                lines.push(`        await expect(${client.name}.${m.name}(anyArgs)).rejects.toThrow();`);
                lines.push(`        expect(apiFetch).not.toHaveBeenCalled();`);
                lines.push(`    });`);
                lines.push(``);
                continue;
            }
            const segments = pathSegments(m.rawPath);
            const testName = JSON.stringify(`${m.name} calls ${m.method} ${m.rawPath}`);
            const callArgs = m.args || 'anyArgs';
            lines.push(`    it(${testName}, async () => {`);
            lines.push(`        await ${client.name}.${m.name}(${callArgs}).catch(() => {});`);
            lines.push(`        expect(apiFetch).toHaveBeenCalled();`);
            lines.push(`        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];`);
            lines.push(`        expect(String(options.method || 'GET')).toBe('${m.method}');`);
            if (segments.length === 1 && !m.rawPath.includes('${')) {
                lines.push(`        expect(String(reqPath)).toBe(${JSON.stringify(segments[0])});`);
            } else {
                for (const segment of segments) {
                    lines.push(`        expect(String(reqPath)).toContain(${JSON.stringify(segment)});`);
                }
            }
            if (m.usesAuthHeader) {
                lines.push(`        expect(options.headers && options.headers.Authorization).toBe('Bearer test');`);
            }
            lines.push(`    });`);
            lines.push(``);
        }
        lines.push(`});`);
        lines.push(``);
    }
    return lines.join('\n');
}

let generated = 0;
const skipped = [];
for (const file of TARGETS) {
    const full = path.join(API_DIR, file);
    if (!fs.existsSync(full)) { skipped.push(`${file} (missing)`); continue; }
    const source = fs.readFileSync(full, 'utf8');
    const fileOverrides = METHOD_OVERRIDES[file] || {};
    const clients = extractClients(source)
        .map((client) => ({
            ...client,
            methods: extractMethods(client.body).map((m) => {
                const override = fileOverrides[m.name] || {};
                return { ...m, ...override, ...(override.route || {}) };
            }),
        }));
    const out = render(file, clients);
    if (!out) { skipped.push(file); continue; }
    fs.writeFileSync(path.join(API_DIR, file.replace(/\.js$/, '.route.test.js')), out);
    generated += 1;
}
console.log('generated:', generated, 'skipped:', skipped.join(', ') || 'none');
