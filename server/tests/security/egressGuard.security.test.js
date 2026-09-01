const dns = require('dns');
const fs = require('fs');
const path = require('path');

const {
    isDeniedIpAddress,
    isDeniedHostname,
    guardedFetch,
    safeConnectLookup,
    stripSensitiveHeaders,
    validateRemoteFetchUrl,
} = require('../../security/remoteFetchGuardService');
const {
    __getBufferedEvents,
    __resetBufferedEvents,
} = require('../../security/securityEventLogger');

const PUBLIC_V4 = [{ address: '93.184.216.34', family: 4 }];

const jsonResponse = (status, { location = '' } = {}) => ({
    status,
    headers: {
        get: (name) => (String(name).toLowerCase() === 'location' ? location : null),
    },
});

const lastBlockedReason = () => __getBufferedEvents()
    .filter((entry) => entry.event === 'ssrf.blocked')
    .at(-1)?.reasonCode;

describe('egress guard — SSRF range closure', () => {
    test('IPv4-mapped IPv6 metadata and private embeddings are denied', () => {
        expect(isDeniedIpAddress('::ffff:169.254.169.254')).toBe(true);
        expect(isDeniedIpAddress('::ffff:a9fe:a9fe')).toBe(true);
        expect(isDeniedIpAddress('0:0:0:0:0:ffff:a9fe:a9fe')).toBe(true);
        expect(isDeniedIpAddress('64:ff9b::a9fe:a9fe')).toBe(true);
        expect(isDeniedIpAddress('2002:a9fe:a9fe::')).toBe(true);
        expect(isDeniedIpAddress('::ffff:10.0.0.8')).toBe(true);
    });

    test('reserved, documentation, multicast, and benchmark IPv4 ranges are denied', () => {
        expect(isDeniedIpAddress('192.0.0.1')).toBe(true);
        expect(isDeniedIpAddress('192.0.2.9')).toBe(true);
        expect(isDeniedIpAddress('198.51.100.7')).toBe(true);
        expect(isDeniedIpAddress('203.0.113.9')).toBe(true);
        expect(isDeniedIpAddress('198.18.0.1')).toBe(true);
        expect(isDeniedIpAddress('198.19.255.255')).toBe(true);
        expect(isDeniedIpAddress('224.0.0.1')).toBe(true);
        expect(isDeniedIpAddress('240.0.0.1')).toBe(true);
        expect(isDeniedIpAddress('255.255.255.255')).toBe(true);
    });

    test('public addresses still pass the deny filter', () => {
        expect(isDeniedIpAddress('8.8.8.8')).toBe(false);
        expect(isDeniedIpAddress('142.250.183.14')).toBe(false);
        expect(isDeniedIpAddress('::ffff:8.8.8.8')).toBe(false);
        expect(isDeniedIpAddress('2606:4700::6810:85e5')).toBe(false);
        expect(isDeniedIpAddress('2620:0:2d0:200::7')).toBe(false);
    });

    test('bracketed IPv6 literal hostnames are denied', () => {
        expect(isDeniedHostname('[::1]')).toBe(true);
        expect(isDeniedHostname('[::ffff:169.254.169.254]')).toBe(true);
    });
});

describe('egress guard — validation-time lookups', () => {
    afterEach(() => jest.restoreAllMocks());

    test('hostname resolving to a mapped metadata address is rejected', async () => {
        jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
            { address: '::ffff:169.254.169.254', family: 6 },
        ]);
        __resetBufferedEvents();

        await expect(validateRemoteFetchUrl({ url: 'https://images.unsplash.com/a.png' }))
            .rejects
            .toThrow('Remote URL is not allowed.');

        expect(lastBlockedReason()).toBe('remote_resolved_private_ip');
    });
});

describe('egress guard — guardedFetch redirect policy', () => {
    beforeEach(() => __resetBufferedEvents());
    afterEach(() => jest.restoreAllMocks());

    const allowUnsplash = ['images.unsplash.com'];

    test('redirect to the metadata IP is blocked without fetching it', async () => {
        jest.spyOn(dns.promises, 'lookup').mockResolvedValue(PUBLIC_V4);
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(jsonResponse(302, { location: 'http://169.254.169.254/latest/meta-data/' }));

        await expect(guardedFetch('https://images.unsplash.com/photo', {
            allowedHosts: allowUnsplash,
            fetchImpl,
            timeoutMs: 1000,
        })).rejects.toThrow('Remote URL is not allowed.');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        // With a proxy allowlist configured, the host check rejects the
        // metadata target before the metadata-host denylist is consulted.
        expect(lastBlockedReason()).toBe('remote_host_not_allowlisted');
    });

    test('redirect to a non-allowlisted public host is blocked', async () => {
        jest.spyOn(dns.promises, 'lookup').mockResolvedValue(PUBLIC_V4);
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(jsonResponse(302, { location: 'https://evil.example.com/payload.png' }));

        await expect(guardedFetch('https://images.unsplash.com/photo', {
            allowedHosts: allowUnsplash,
            fetchImpl,
            timeoutMs: 1000,
        })).rejects.toThrow('Remote URL is not allowed.');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(lastBlockedReason()).toBe('remote_host_not_allowlisted');
    });

    test('redirect to a host that resolves private is blocked', async () => {
        const lookup = jest.spyOn(dns.promises, 'lookup');
        lookup.mockResolvedValueOnce(PUBLIC_V4);
        lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(jsonResponse(302, { location: 'http://internal-cdn.example.com/secret' }));

        await expect(guardedFetch('https://images.unsplash.com/photo', {
            allowedHosts: [...allowUnsplash, 'internal-cdn.example.com'],
            fetchImpl,
            timeoutMs: 1000,
        })).rejects.toThrow('Remote URL is not allowed.');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(lastBlockedReason()).toBe('remote_resolved_private_ip');
    });

    test('allowlisted redirect is followed and sensitive headers are stripped', async () => {
        jest.spyOn(dns.promises, 'lookup').mockResolvedValue(PUBLIC_V4);
        const finalResponse = jsonResponse(200);
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(jsonResponse(302, { location: 'https://images.unsplash.com/real.png' }))
            .mockResolvedValueOnce(finalResponse);

        const response = await guardedFetch('https://images.unsplash.com/photo', {
            allowedHosts: allowUnsplash,
            fetchImpl,
            timeoutMs: 1000,
            headers: { authorization: 'Bearer secret-token', accept: 'image/*' },
        });

        expect(response).toBe(finalResponse);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const [, secondInit] = fetchImpl.mock.calls[1];
        expect(secondInit.headers.authorization).toBeUndefined();
        expect(secondInit.headers.accept).toBe('image/*');
    });

    test('redirect hop limit is enforced', async () => {
        jest.spyOn(dns.promises, 'lookup').mockResolvedValue(PUBLIC_V4);
        const fetchImpl = jest.fn()
            .mockImplementation(() => Promise.resolve(jsonResponse(302, { location: 'https://images.unsplash.com/next' })));

        await expect(guardedFetch('https://images.unsplash.com/photo', {
            allowedHosts: allowUnsplash,
            fetchImpl,
            timeoutMs: 1000,
            maxRedirects: 2,
        })).rejects.toThrow('Remote URL is not allowed.');

        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(lastBlockedReason()).toBe('redirect_limit_exceeded');
    });
});

describe('egress guard — connect-time pinning', () => {
    afterEach(() => jest.restoreAllMocks());

    test('connect lookup denies a hostname that resolves private at connect time', (done) => {
        jest.spyOn(dns, 'lookup').mockImplementation((hostname, options, callback) => {
            callback(null, [{ address: '10.0.0.5', family: 4 }]);
        });

        safeConnectLookup('rebind.attacker.test', {}, (error) => {
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain('safe_egress_connect_denied');
            expect(error.message).toContain('10.0.0.5');
            done();
        });
    });

    test('connect lookup passes public resolutions through', (done) => {
        jest.spyOn(dns, 'lookup').mockImplementation((hostname, options, callback) => {
            callback(null, [
                { address: '93.184.216.34', family: 4 },
                { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
            ]);
        });

        safeConnectLookup('example.com', {}, (error, address, family) => {
            expect(error).toBeNull();
            expect(address).toBe('93.184.216.34');
            expect(family).toBe(4);
            done();
        });
    });
});

describe('egress guard — header stripping helper', () => {
    test('credential headers are removed case-insensitively', () => {
        const stripped = stripSensitiveHeaders({
            Authorization: 'Bearer token',
            COOKIE: 'session=1',
            'X-Goog-Api-Key': 'key',
            accept: 'image/*',
        });
        expect(stripped).toEqual({ accept: 'image/*' });
    });
});

describe('egress guard — image proxy source contract', () => {
    const controllerPath = path.join(__dirname, '..', '..', 'controllers', 'productController.js');
    const controllerSource = fs.readFileSync(controllerPath, 'utf8');

    test('public image proxy routes upstream fetches through guardedFetch', () => {
        expect(controllerSource).toContain('guardedFetch(upstreamUrl');
    });

    test('image proxy no longer follows redirects blindly', () => {
        expect(controllerSource).not.toContain("redirect: 'follow'");
    });
});
