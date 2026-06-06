const dns = require('dns').promises;
const net = require('net');
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
    const [a, b] = parts;
    return a === 10
        || (a === 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 0)
        || (a === 100 && b >= 64 && b <= 127);
};

const isPrivateIpv6 = (ip = '') => {
    const normalized = String(ip || '').toLowerCase();
    return normalized === '::1'
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe80:')
        || normalized === '::'
        || normalized.startsWith('::ffff:127.')
        || normalized.startsWith('::ffff:10.')
        || normalized.startsWith('::ffff:192.168.');
};

const isDeniedIpAddress = (ip = '') => {
    const version = net.isIP(String(ip || ''));
    if (version === 4) return isPrivateIpv4(ip);
    if (version === 6) return isPrivateIpv6(ip);
    return false;
};

const isDeniedHostname = (host = '') => {
    const normalized = String(host || '').trim().toLowerCase().replace(/\.$/, '');
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

const validateRemoteFetchUrl = async ({
    url,
    req = null,
    allowedHosts = [],
    timeoutMs = 3000,
} = {}) => {
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

    if (isDeniedHostname(host)) {
        rejectRemoteFetch({ req, url, reason: 'remote_host_denied' });
    }

    const lookup = await Promise.race([
        dns.lookup(host, { all: true, verbatim: true }),
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

module.exports = {
    isDeniedHostname,
    isDeniedIpAddress,
    isPrivateIpv4,
    isPrivateIpv6,
    validateRemoteFetchUrl,
};
