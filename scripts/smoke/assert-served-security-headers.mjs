import process from 'node:process';

/**
 * Asserts that every production storefront lane serves a Content-Security-Policy
 * header that names the CURRENT backend origin — and no other CloudFront edge.
 *
 * Why this exists: the repository can regenerate every CSP copy and stay
 * internally consistent while a lane serves a stale one in production. Two real
 * instances of that gap:
 *
 *   - Cloudflare Pages merges every matching `_headers` block by appending, so
 *     the duplicated security set pushed the ~3 KB CSP past Cloudflare's header
 *     limit and Cloudflare dropped it entirely.
 *   - Render only re-applies `render.yaml` headers when its blueprint is
 *     re-applied, which CI never triggers, so the served header stayed pinned to
 *     the previous origin after a successful origin swap.
 *
 * A lane with no CSP header is reported but not failed: GitHub Pages cannot set
 * custom headers, and those lanes fall back to the meta CSP in index.html,
 * which the CSP drift gate already keeps in sync.
 */

const TIMEOUT_MS = Number(process.env.HEADER_CHECK_TIMEOUT_MS || 20000);

const CLOUDFRONT_ORIGIN_PATTERN = /https?:\/\/[a-z0-9]+\.cloudfront\.net/gi;

const readLaneUrls = () => String(process.env.LANE_URLS || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
        const separatorIndex = line.indexOf('=');

        if (separatorIndex < 1) {
            throw new Error(`LANE_URLS entries must be "label=url"; received "${line}".`);
        }

        return { label: line.slice(0, separatorIndex), url: line.slice(separatorIndex + 1).trim() };
    })
    .filter(({ url }) => url.length > 0);

const fetchWithTimeout = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        return await fetch(url, {
            redirect: 'manual',
            signal: controller.signal,
            headers: { 'user-agent': 'aura-served-header-check/1.0' },
        });
    } finally {
        clearTimeout(timer);
    }
};

const checkLane = async ({ label, url }, expectedOrigin) => {
    const response = await fetchWithTimeout(url);
    const csp = response.headers.get('content-security-policy') || '';
    const findings = [];

    if (!csp) {
        return {
            label,
            url,
            status: response.status,
            mode: 'meta-only',
            cspLength: 0,
            findings: [],
        };
    }

    if (!csp.includes(expectedOrigin)) {
        findings.push(
            `${label} (${url}) served a CSP header that does not name the current backend origin ${expectedOrigin}.`
        );
    }

    const servedOrigins = [...new Set((csp.match(CLOUDFRONT_ORIGIN_PATTERN) || []).map((value) => value.toLowerCase()))];
    const staleOrigins = servedOrigins.filter((origin) => origin !== expectedOrigin.toLowerCase());

    if (staleOrigins.length > 0) {
        findings.push(
            `${label} (${url}) served a CSP header still naming a retired backend origin: ${staleOrigins.join(', ')}.`
        );
    }

    return {
        label,
        url,
        status: response.status,
        mode: 'header',
        cspLength: csp.length,
        findings,
    };
};

const main = async () => {
    const expectedOrigin = String(process.env.EXPECTED_BACKEND_ORIGIN || '').trim().replace(/\/+$/, '');

    if (!/^https:\/\//i.test(expectedOrigin)) {
        throw new Error(`EXPECTED_BACKEND_ORIGIN must be an HTTPS origin; received "${expectedOrigin}".`);
    }

    const lanes = readLaneUrls();

    if (lanes.length === 0) {
        throw new Error('LANE_URLS is empty; nothing to verify.');
    }

    console.log(`Served-header contract: every CSP header must name ${expectedOrigin}.`);
    console.log('');

    const failures = [];
    const metaOnly = [];

    for (const lane of lanes) {
        let result;

        try {
            result = await checkLane(lane, expectedOrigin);
        } catch (error) {
            result = {
                label: lane.label,
                url: lane.url,
                status: 0,
                mode: 'error',
                cspLength: 0,
                findings: [`${lane.label} (${lane.url}) could not be probed: ${error?.message || error}`],
            };
        }

        console.log(`  ${result.mode.padEnd(9)} HTTP ${result.status}  ${result.url}`);

        if (result.mode === 'meta-only') {
            metaOnly.push(result.url);
        }

        failures.push(...result.findings);
    }

    console.log('');

    if (metaOnly.length > 0) {
        console.log(`Lanes relying on the meta CSP only: ${metaOnly.join(', ')}`);
        console.log('');
    }

    if (failures.length > 0) {
        console.error('Served-header contract violated:');
        for (const finding of failures) {
            console.error(`  - ${finding}`);
        }
        console.error('');
        console.error('A lane can pass the in-repo CSP drift gate and still serve a stale or missing');
        console.error('CSP header, because that gate only reads committed files. Regenerating config');
        console.error('does not re-apply a host-side header: Render needs its Blueprint re-applied, and');
        console.error('Cloudflare Pages only picks up _headers on a new upload.');
        process.exit(1);
    }

    console.log('All lanes serve a CSP header naming the current backend origin.');
};

await main();