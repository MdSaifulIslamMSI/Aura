import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const parseArgs = () => {
    const args = new Map();
    for (const rawArg of process.argv.slice(2)) {
        const [rawKey, ...rawValueParts] = rawArg.split('=');
        const key = rawKey.replace(/^--/, '').trim();
        const value = rawValueParts.join('=').trim();
        if (key) args.set(key, value);
    }
    return args;
};

const args = parseArgs();
const expectedReleaseId = args.get('release-id') || process.env.AURA_EXPECTED_RELEASE_ID || '';
const expectedCommit = args.get('commit') || process.env.AURA_EXPECTED_COMMIT || '';
const expectedTarget = args.get('target') || process.env.AURA_EXPECTED_TARGET || 'multi-host';
const rawUrls = args.get('urls') || process.env.AURA_RELEASE_URLS || '[]';
const builtAtMaxSkewSecondsRaw =
    args.get('built-at-max-skew-seconds') ||
    process.env.AURA_RELEASE_BUILT_AT_MAX_SKEW_SECONDS ||
    '300';
const builtAtMaxSkewSeconds = Number(builtAtMaxSkewSecondsRaw);

if (!Number.isFinite(builtAtMaxSkewSeconds) || builtAtMaxSkewSeconds < 0) {
    throw new Error('AURA_RELEASE_BUILT_AT_MAX_SKEW_SECONDS must be a non-negative number.');
}

const urls = JSON.parse(rawUrls);
if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('AURA_RELEASE_URLS must be a non-empty JSON array.');
}

const extractMeta = (html, name) => {
    const pattern = new RegExp(`<meta\\s+[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
    const match = html.match(pattern);
    return match?.[1] || '';
};

const withCacheBust = (url) => {
    const parsed = new URL(url);
    parsed.searchParams.set('__aura_release_check', `${Date.now()}`);
    return parsed.toString();
};

const readTargetHtml = async ({ name, url, htmlPath }) => {
    if (htmlPath) {
        return readFile(htmlPath, 'utf8');
    }

    const response = await fetch(withCacheBust(url), {
        headers: {
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
        },
    });

    if (!response.ok) {
        throw new Error(`${name} returned HTTP ${response.status} for ${url}`);
    }

    return response.text();
};

const extractEntryBundleSrc = (html, name) => {
    const match = html.match(/<script[^>]+src=["']([^"']+\.js)["']/);
    if (!match) {
        throw new Error(`${name} HTML does not reference an entry script; cannot verify bundle bytes.`);
    }
    return match[1];
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const readTargetBundle = async (target) => {
    if (target.bundlePath) {
        return readFile(target.bundlePath);
    }

    const bundleUrl = new URL(target.bundleSrc, target.url);
    const response = await fetch(withCacheBust(bundleUrl.toString()), {
        headers: {
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
        },
    });

    if (!response.ok) {
        throw new Error(`${target.name} returned HTTP ${response.status} for ${bundleUrl}`);
    }

    return Buffer.from(await response.arrayBuffer());
};

const parseBuiltAt = (value, name) => {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        throw new Error(`${name} builtAt=${value} is not a valid timestamp.`);
    }
    return timestamp;
};

const results = [];

for (const target of urls) {
    const name = String(target?.name || '').trim();
    const url = String(target?.url || '').trim();
    const htmlPath = String(target?.htmlPath || '').trim();
    const bundlePath = String(target?.bundlePath || '').trim();
    if (!name || !url) {
        throw new Error(`Invalid release URL target: ${JSON.stringify(target)}`);
    }

    const html = await readTargetHtml({ name, url, htmlPath });
    const release = {
        name,
        url,
        bundlePath,
        id: extractMeta(html, 'aura-release-id'),
        commit: extractMeta(html, 'aura-release-commit'),
        target: extractMeta(html, 'aura-release-target'),
        channel: extractMeta(html, 'aura-release-channel'),
        builtAt: extractMeta(html, 'aura-release-built-at'),
    };

    for (const field of ['id', 'commit', 'target', 'channel', 'builtAt']) {
        if (!release[field]) {
            throw new Error(`${name} is missing aura-release-${field === 'builtAt' ? 'built-at' : field} metadata.`);
        }
    }

    if (expectedReleaseId && release.id !== expectedReleaseId) {
        throw new Error(`${name} release id ${release.id} does not match expected ${expectedReleaseId}.`);
    }

    if (expectedCommit && !expectedCommit.startsWith(release.commit)) {
        throw new Error(`${name} commit ${release.commit} does not match expected ${expectedCommit}.`);
    }

    if (expectedTarget && release.target !== expectedTarget) {
        throw new Error(`${name} target ${release.target} does not match expected ${expectedTarget}.`);
    }

    release.bundleSrc = extractEntryBundleSrc(html, name);
    results.push(release);
}

const computeBundleHashes = async () => {
    for (const release of results) {
        const bundle = await readTargetBundle(release);
        release.bundleSha256 = sha256(bundle);
        release.bundleBytes = bundle.length;
        console.error(`${release.name} entry bundle ${release.bundleSrc} bytes=${bundle.length} sha256=${release.bundleSha256}`);
    }
};

await computeBundleHashes();

const bundleMismatch = () => {
    const baseline = results[0];
    return results.find((release) => release.bundleSha256 !== baseline.bundleSha256);
};

let offender = bundleMismatch();
if (offender) {
    console.error('Entry bundle bytes differ across hosts; retrying once after 10s (CDN propagation).');
    await new Promise((resolve) => setTimeout(resolve, 10000));
    await computeBundleHashes();
    offender = bundleMismatch();
}

if (offender) {
    const hashes = results
        .map((release) => `${release.name} ${release.bundleSrc} bytes=${release.bundleBytes} sha256=${release.bundleSha256.slice(0, 16)}`)
        .join(' | ');
    throw new Error(
        `${offender.name} entry bundle is not byte-identical to ${results[0].name} (${hashes}). ` +
        'Multi-host storefronts must serve the same bytes; check that every host builds the pinned commit with the same VITE_* build env.'
    );
}

const baseline = results[0];
const baselineBuiltAt = parseBuiltAt(baseline.builtAt, baseline.name);
let maxObservedBuiltAtSkewSeconds = 0;
for (const result of results.slice(1)) {
    for (const field of ['id', 'commit', 'target', 'channel']) {
        if (result[field] !== baseline[field]) {
            throw new Error(`${result.name} ${field}=${result[field]} differs from ${baseline.name} ${field}=${baseline[field]}.`);
        }
    }

    const builtAtSkewSeconds = Math.abs(parseBuiltAt(result.builtAt, result.name) - baselineBuiltAt) / 1000;
    maxObservedBuiltAtSkewSeconds = Math.max(maxObservedBuiltAtSkewSeconds, builtAtSkewSeconds);
    if (builtAtSkewSeconds > builtAtMaxSkewSeconds) {
        throw new Error(
            `${result.name} builtAt=${result.builtAt} differs from ${baseline.name} builtAt=${baseline.builtAt} by ${builtAtSkewSeconds}s, exceeding ${builtAtMaxSkewSeconds}s.`
        );
    }
}

console.log(JSON.stringify({
    coherent: true,
    release: {
        id: baseline.id,
        commit: baseline.commit,
        target: baseline.target,
        channel: baseline.channel,
        builtAt: baseline.builtAt,
        builtAtMaxSkewSeconds,
        maxObservedBuiltAtSkewSeconds,
        bundleSha256: baseline.bundleSha256,
    },
    hosts: results.map(({ name, url, bundleSha256 }) => ({ name, url, bundleSha256 })),
}, null, 2));
