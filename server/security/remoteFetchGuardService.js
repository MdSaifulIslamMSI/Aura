const dns = require('dns');
const net = require('net');
const { Agent } = require('undici');
const AppError = require('../utils/AppError');
const { writeSecurityEvent } = require('./securityEventLogger');

const METADATA_HOSTS = new Set([
    '169.254.169.254',
    'metadata.google.internal',
    'metadata',
]);

const isPrivateIpv4 = (ip = '') => {
    const parts = String(ip).split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b, c] = parts;
    return a === 10
        || a === 127
        || a === 0
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127)
        // IETF protocol assignments, documentation ranges, and benchmarking space.
        || (a === 192 && b === 0 && (c === 0 || c === 2))
        || (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100)))
        || (a === 203 && b === 0 && c === 113)
        // Multicast, reserved future-use, and broadcast space.
        || a >= 224;
};

// Expands any valid IPv6 textual form (compressed ::, mixed dotted-quad,
// fully expanded) into its eight hex groups.
const expandIpv6Groups = (ip = '') => {
    let text = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (text.includes('%')) text = text.split('%')[0];
    const halves = text.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 && missing !== 0) return null;
    if (halves.length === 2 && missing < 1) return null;
    return [...head, ...Array.from({ length: Math.max(missing, 0) }, () => '0'), ...tail];
};

// Reconstructs the IPv4 address embedded in the final 32 bits of an
// IPv4-embedded IPv6 form (::ffff:*, 64:ff9b::*, 2002:*).
const decodeEmbeddedIpv4 = (highGroup, lowGroup) => {
    const high = parseInt(String(highGroup || ''), 16);
    const low = parseInt(String(lowGroup || ''), 16);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return '0.0.0.0';
    return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join('.');
};

const isPrivateIpv6 = (ip = '') => {
    const normalized = String(ip || '').toLowerCase();
    if (!normalized || !normalized.includes(':')) return false;

    const groups = expandIpv6Groups(normalized);
    if (!groups || groups.length !== 8) return false;

    // Mixed notation embeds a dotted IPv4 address as the trailing group.
    const dottedMatch = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dottedMatch) return isPrivateIpv4(dottedMatch[1]);

    const values = groups.map((group) => parseInt(group, 16));
    if (values.some((value) => !Number.isFinite(value))) return false;

    // IPv4-embedded forms route back into IPv4 address space.
    if (values[0] === 0x64 && values[1] === 0xff9b) return isPrivateIpv4(decodeEmbeddedIpv4(groups[6], groups[7]));
    if (values[0] === 0x2002) return isPrivateIpv4(decodeEmbeddedIpv4(groups[1], groups[2]));
    if (values.slice(0, 5).every((value) => value === 0) && values[5] === 0xffff) {
        return isPrivateIpv4(decodeEmbeddedIpv4(groups[6], groups[7]));
    }

    const isUnspecified = values.every((value) => value === 0);
    const isLoopback = values.slice(0, 7).every((value) => value === 0) && values[7] === 1;
    return isUnspecified
        || isLoopback
        || (values[0] & 0xfe00) === 0xfc00 // ULA fc00::/7
        || (values[0] & 0xffc0) === 0xfe80; // Link-local fe80::/10
};

const isDeniedIpAddress = (ip = '') => {
    const version = net.isIP(String(ip || ''));
    if (version === 4) return isPrivateIpv4(ip);
    if (version === 6) return isPrivateIpv6(ip);
    return false;
};

const isDeniedHostname = (host = '') => {
    const normalized = String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    return !normalized
        || normalized === 'localhost'
        || normalized.endsWith('.localhost')
        || METADATA_HOSTS.has(normalized)
        || isDeniedIpAddress(normalized);
};

const rejectRemoteFetch = ({ req = null, url = '', reason = 'remote_fetch_blocked' } = {}) => {
    writeSecurityEvent({
        event: 'ssrf.blocked',
        req,
        action: 'upload.remoteFetch',
        riskScore: 70,
        decision: 'DENY',
        reasonCode: reason,
        metadata: { urlHost: (() => {
            try {
                return new URL(url).hostname;
            } catch {
                return '';
            }
        })() },
    }, { level: 'warn' });

    const error = new AppError('Remote URL is not allowed.', 400);
    error.code = String(reason).toUpperCase();
    throw error;
};

// String-only URL policy check (scheme, allowlist, denylist). Used by
// validateRemoteFetchUrl before its DNS resolution and directly by
// guardedFetch in operator mode, where the configured host is trusted and
// connect-time pinning provides the authoritative private-IP enforcement.
const assertRemoteFetchPolicy = ({ url, req = null, allowedHosts = [], allowPrivateTarget = false } = {}) => {
    let parsed;
    try {
        parsed = new URL(String(url || ''));
    } catch {
        rejectRemoteFetch({ req, url, reason: 'remote_url_invalid' });
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        rejectRemoteFetch({ req, url, reason: 'remote_scheme_denied' });
    }

    const host = parsed.hostname;
    const normalizedAllowedHosts = new Set(allowedHosts.map((entry) => String(entry || '').toLowerCase()));
    if (normalizedAllowedHosts.size && !normalizedAllowedHosts.has(host.toLowerCase())) {
        rejectRemoteFetch({ req, url, reason: 'remote_host_not_allowlisted' });
    }

    // Operator-configured destinations may legitimately be internal
    // (self-hosted Ollama, LibreTranslate, status probes of internal deps);
    // the allowlist above already pins the host to operator configuration.
    if (!allowPrivateTarget && isDeniedHostname(host)) {
        rejectRemoteFetch({ req, url, reason: 'remote_host_denied' });
    }

    return parsed;
};

const validateRemoteFetchUrl = async ({
    url,
    req = null,
    allowedHosts = [],
    timeoutMs = 3000,
} = {}) => {
    const parsed = assertRemoteFetchPolicy({ url, req, allowedHosts });
    const host = parsed.hostname;

    const lookup = await Promise.race([
        dns.promises.lookup(host, { all: true, verbatim: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('dns_lookup_timeout')), timeoutMs)),
    ]).catch((error) => {
        rejectRemoteFetch({ req, url, reason: error.message === 'dns_lookup_timeout' ? 'dns_lookup_timeout' : 'dns_lookup_failed' });
    });

    const deniedAddress = lookup.find((entry) => isDeniedIpAddress(entry.address));
    if (deniedAddress) {
        rejectRemoteFetch({ req, url, reason: 'remote_resolved_private_ip' });
    }

    return {
        ok: true,
        url: parsed.toString(),
        addresses: lookup.map((entry) => entry.address),
    };
};

// Connect-time enforcement: every connection made through the safe egress
// agent re-resolves DNS and refuses private/metadata targets. This closes the
// DNS-rebinding window that validation-time checks leave open and applies to
// redirect hops that open new connections.
const safeConnectLookup = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error);
        const list = (Array.isArray(addresses) ? addresses : [addresses]).filter(Boolean);
        const denied = list.find((entry) => isDeniedIpAddress(entry.address));
        if (denied) {
            return callback(new Error(`safe_egress_connect_denied:${denied.address}`));
        }
        if (list.length === 0) {
            return callback(new Error('safe_egress_connect_no_address'));
        }
        if (options && options.all) return callback(null, list);
        return callback(null, list[0].address, list[0].family);
    });
};

let safeEgressAgent;
const getSafeEgressAgent = () => {
    if (!safeEgressAgent) {
        safeEgressAgent = new Agent({
            connect: { lookup: safeConnectLookup },
        });
    }
    return safeEgressAgent;
};

const SENSITIVE_REQUEST_HEADERS = new Set([
    'authorization',
    'cookie',
    'proxy-authorization',
    'x-api-key',
    'x-goog-api-key',
    'x-auth-token',
    'x-csrf-token',
]);

const stripSensitiveHeaders = (headers = {}) => {
    const next = {};
    for (const [name, value] of Object.entries(headers || {})) {
        if (!SENSITIVE_REQUEST_HEADERS.has(String(name).toLowerCase())) {
            next[name] = value;
        }
    }
    return next;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Fetch wrapper that enforces the remote-fetch policy on the initial URL and
// on every redirect hop, with connect-time private-IP pinning via the safe
// egress agent. `fetchImpl` is injectable for tests. With `validateDns:
// false` (operator mode for fixed, configured hosts) hops are checked with
// the string-only policy and the safe egress agent remains the authoritative
// private-IP enforcement at connect time.
const guardedFetch = async (url, {
    allowedHosts = [],
    maxRedirects = 3,
    timeoutMs = 8000,
    method = 'GET',
    headers = {},
    body = undefined,
    signal = undefined,
    req = null,
    validateDns = true,
    allowPrivateTarget = false,
    fetchImpl = fetch,
} = {}) => {
    // Internal-target operator calls (self-hosted Ollama, LibreTranslate,
    // status probes of internal deps) connect directly; everything else goes
    // through the safe egress agent, which denies private/metadata targets at
    // connect time.
    const dispatcher = allowPrivateTarget ? undefined : getSafeEgressAgent();
    const validateUrl = async (hopUrl) => {
        if (validateDns) {
            await validateRemoteFetchUrl({ url: hopUrl, req, allowedHosts, timeoutMs });
            return;
        }
        assertRemoteFetchPolicy({ url: hopUrl, req, allowedHosts, allowPrivateTarget });
    };
    let currentUrl = String(url || '');
    let currentHeaders = { ...headers };
    let currentMethod = method;
    let currentBody = body;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
        await validateUrl(currentUrl);

        const response = await fetchImpl(currentUrl, {
            method: currentMethod,
            headers: currentHeaders,
            body: currentBody,
            redirect: 'manual',
            signal: signal || AbortSignal.timeout(timeoutMs),
            dispatcher,
        });

        if (!REDIRECT_STATUSES.has(response.status)) {
            return response;
        }

        const location = response.headers.get('location');
        if (!location) {
            rejectRemoteFetch({ req, url: currentUrl, reason: 'redirect_location_missing' });
        }
        try {
            currentUrl = new URL(location, currentUrl).toString();
        } catch {
            rejectRemoteFetch({ req, url: currentUrl, reason: 'redirect_location_invalid' });
        }

        currentHeaders = stripSensitiveHeaders(currentHeaders);
        currentBody = undefined;
        if (response.status === 303 && currentMethod !== 'GET' && currentMethod !== 'HEAD') {
            currentMethod = 'GET';
        }
    }

    rejectRemoteFetch({ req, url: currentUrl, reason: 'redirect_limit_exceeded' });
};

module.exports = {
    isDeniedHostname,
    isDeniedIpAddress,
    isPrivateIpv4,
    isPrivateIpv6,
    validateRemoteFetchUrl,
    assertRemoteFetchPolicy,
    guardedFetch,
    safeConnectLookup,
    stripSensitiveHeaders,
};
