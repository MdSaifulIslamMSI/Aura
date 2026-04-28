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

const results = [];

for (const target of urls) {
    const name = String(target?.name || '').trim();
    const url = String(target?.url || '').trim();
    if (!name || !url) {
        throw new Error(`Invalid release URL target: ${JSON.stringify(target)}`);
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

    const html = await response.text();
    const release = {
        name,
        url,
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

    results.push(release);
}

const baseline = results[0];
for (const result of results.slice(1)) {
    for (const field of ['id', 'commit', 'target', 'channel', 'builtAt']) {
        if (result[field] !== baseline[field]) {
            throw new Error(`${result.name} ${field}=${result[field]} differs from ${baseline.name} ${field}=${baseline[field]}.`);
        }
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
    },
    hosts: results.map(({ name, url }) => ({ name, url })),
}, null, 2));
