const loadService = ({ lookupImpl, trustedHosts = '', trustedDomains = '' } = {}) => {
    jest.resetModules();
    process.env.CATALOG_SNAPSHOT_TRUSTED_HOSTS = trustedHosts;
    process.env.CATALOG_SNAPSHOT_TRUSTED_DOMAINS = trustedDomains;

    jest.doMock('dns', () => ({
        promises: {
            lookup: jest.fn(lookupImpl || (async (hostname) => [{ address: hostname, family: hostname.includes(':') ? 6 : 4 }])),
        },
    }));

    return require('../services/catalogSnapshotService');
};

describe('catalogSnapshotService remote ref SSRF protections', () => {
    beforeEach(() => {
        delete process.env.CATALOG_SNAPSHOT_TRUSTED_HOSTS;
        delete process.env.CATALOG_SNAPSHOT_TRUSTED_DOMAINS;
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.dontMock('dns');
    });

    test.each([
        'https://localhost/catalog.jsonl',
        'https://169.254.169.254/latest/meta-data',
        'https://10.10.10.10/catalog.jsonl',
        'https://127.0.0.1/catalog.jsonl',
        'https://[::1]/catalog.jsonl',
    ])('blocks unsafe remote source URL: %s', async (sourceRef) => {
        const { inspectCatalogSnapshot } = loadService({
            lookupImpl: async (hostname) => [{ address: hostname, family: hostname.includes(':') ? 6 : 4 }],
        });

        await expect(inspectCatalogSnapshot({
            sourceType: 'jsonl',
            sourceRef,
            manifestRef: 'unused.manifest.json',
        })).rejects.toThrow('Remote snapshot URL');

        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('blocks hostnames that resolve to blocked private addresses', async () => {
        const { inspectCatalogSnapshot } = loadService({
            lookupImpl: async () => [{ address: '10.2.3.4', family: 4 }],
        });

        await expect(inspectCatalogSnapshot({
            sourceType: 'jsonl',
            sourceRef: 'https://trusted.example.com/catalog.jsonl',
            manifestRef: 'unused.manifest.json',
        })).rejects.toThrow('resolves to private or link-local network');

        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('enforces trusted hostname/domain allowlist for remote URLs', async () => {
        const { inspectCatalogSnapshot } = loadService({
            trustedDomains: 'example.com',
            lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
        });

        await expect(inspectCatalogSnapshot({
            sourceType: 'jsonl',
            sourceRef: 'https://untrusted.test/catalog.jsonl',
            manifestRef: 'unused.manifest.json',
        })).rejects.toThrow('hostname is not in trusted allowlist');

        expect(global.fetch).not.toHaveBeenCalled();
    });
});
