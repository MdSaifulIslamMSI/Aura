const dns = require('dns').promises;
const isIp = require('is-ip');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const ALLOWED_PROXY_HOSTNAMES = new Set([
    'rukminim1.flixcart.com',
    'rukminim2.flixcart.com',
    'static-assets-web.flixcart.com',
    'img.freepik.com',
    'images.unsplash.com',
    'cdn.pixabay.com',
    'images.pexels.com',
]);

const PRIVATE_SUBNETS = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/,
];

/**
 * Validates if an IP is private or loopback
 */
const isPrivateIp = (ip) => {
    return PRIVATE_SUBNETS.some((regex) => regex.test(ip));
};

/**
 * Validates if a hostname resolves to a private IP
 */
const validateHostnameDns = async (hostname) => {
    try {
        const addresses = await dns.resolve4(hostname);
        if (addresses.some(isPrivateIp)) {
            return false;
        }
        return true;
    } catch (error) {
        // If it doesn't resolve to IPv4, try IPv6
        try {
            const addresses = await dns.resolve6(hostname);
            if (addresses.some(isPrivateIp)) {
                return false;
            }
            return true;
        } catch {
            return false; // Cannot resolve
        }
    }
};

/**
 * Validates the requested source URL for SSRF protection
 */
const validateProxyUrl = async (sourceUrl) => {
    let url;
    try {
        url = new URL(sourceUrl);
    } catch {
        throw new AppError('Malformed product image URL', 400);
    }

    if (!ALLOWED_PROXY_HOSTNAMES.has(url.hostname)) {
        throw new AppError('Product image source not permitted (Hostname not in allowlist)', 400);
    }

    // Resolve DNS and check for private IPs
    const dnsValid = await validateHostnameDns(url.hostname);
    if (!dnsValid) {
        throw new AppError('Product image source not permitted (Resolves to private network)', 400);
    }

    return url.href;
};

module.exports = {
    validateProxyUrl,
    ALLOWED_PROXY_HOSTNAMES,
};
