const { createOpenFgaService } = require('../services/authorization/openFgaService');

// Minimal fetch stub: records requests, answers according to a scripted
// `allowed` map keyed by "user|relation|object".
const createFetchStub = ({ allowedMap = {}, respondError = false, calls = [] } = {}) => (
    async (url, options = {}) => {
        calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
        const body = JSON.parse(options.body || '{}');
        if (respondError) {
            return { ok: false, status: 503, json: async () => ({ message: 'service unavailable' }) };
        }
        const key = body.tuple_key
            ? `${body.tuple_key.user}|${body.tuple_key.relation}|${body.tuple_key.object}`
            : '';
        return {
            ok: true,
            status: 200,
            json: async () => (body.tuple_key ? { allowed: allowedMap[key] === true } : {}),
        };
    }
);

const BASE_CONFIG = {
    apiUrl: 'http://127.0.0.1:8081',
    storeId: 'store-1',
    authorizationModelId: 'model-1',
    enforcementMode: 'enforce',
};

describe('openFgaService', () => {
    describe('enforcement mode: off', () => {
        it('returns the legacy decision without calling OpenFGA', async () => {
            const calls = [];
            const service = createOpenFgaService({ ...BASE_CONFIG, enforcementMode: 'off' }, {
                fetchImpl: createFetchStub({ calls }),
            });

            const denied = await service.authorizeListingEditor({ userId: 'u1', listingId: 'l1', legacyAllowed: false });
            const allowed = await service.authorizeListingEditor({ userId: 'u1', listingId: 'l1', legacyAllowed: true });

            expect(denied).toMatchObject({ allowed: false, enforced: false, mode: 'off', fgaChecked: false });
            expect(allowed).toMatchObject({ allowed: true, enforced: false });
            expect(calls).toHaveLength(0);
        });

        it('skips tuple writes entirely', async () => {
            const calls = [];
            const service = createOpenFgaService({ ...BASE_CONFIG, enforcementMode: 'off' }, {
                fetchImpl: createFetchStub({ calls }),
            });
            const result = await service.recordTuple({ userId: 'u1', relation: 'owner', object: 'listing:l1' });
            expect(result.skipped).toBe(true);
            expect(calls).toHaveLength(0);
        });
    });

    describe('enforcement mode: monitor', () => {
        it('keeps the legacy decision even when FGA disagrees, and records it', async () => {
            const calls = [];
            const service = createOpenFgaService({ ...BASE_CONFIG, enforcementMode: 'monitor' }, {
                fetchImpl: createFetchStub({
                    calls,
                    allowedMap: { 'user:admin|editor|listing:l1': true },
                }),
            });

            const nonOwnerWhoIsFgaEditor = await service.authorizeListingEditor({
                userId: 'admin', listingId: 'l1', legacyAllowed: false,
            });
            expect(nonOwnerWhoIsFgaEditor).toMatchObject({
                allowed: false, // legacy stands in monitor mode
                enforced: false,
                mode: 'monitor',
                fgaChecked: true,
                fgaAllowed: true,
                disagreement: true,
            });
            expect(calls.some((c) => c.url.includes('/check'))).toBe(true);
        });


    describe('enforcement mode: enforce', () => {
        it('grants editors FGA granted by relations even without the legacy check', async () => {
            const service = createOpenFgaService(BASE_CONFIG, {
                fetchImpl: createFetchStub({ allowedMap: { 'user:admin|editor|listing:l1': true } }),
            });
            const result = await service.authorizeListingEditor({
                userId: 'admin', listingId: 'l1', legacyAllowed: false,
            });
            expect(result).toMatchObject({ allowed: true, enforced: true, mode: 'enforce', fgaChecked: true });
        });

        it('denies users FGA denies even when legacy would allow', async () => {
            const service = createOpenFgaService(BASE_CONFIG, {
                fetchImpl: createFetchStub({ allowedMap: {} }),
            });
            const result = await service.authorizeListingEditor({
                userId: 'stale-owner', listingId: 'l1', legacyAllowed: true,
            });
            expect(result).toMatchObject({ allowed: false, enforced: true });
        });

        it('fails CLOSED when the authorization service is unreachable', async () => {
            const service = createOpenFgaService(BASE_CONFIG, {
                fetchImpl: createFetchStub({ respondError: true }),
            });
            const result = await service.authorizeListingEditor({
                userId: 'u1', listingId: 'l1', legacyAllowed: true,
            });
            expect(result).toMatchObject({ allowed: false, enforced: true, fgaChecked: false });
            expect(result.fgaError).toContain('503');
        });
    });

    describe('tuple writes', () => {
        it('POSTs tuple keys with the authorization model id', async () => {
            const calls = [];
            const service = createOpenFgaService(BASE_CONFIG, {
                fetchImpl: createFetchStub({ calls, allowedMap: {} }),
            });
            const result = await service.writeTuples([
                { user: 'user:u1', relation: 'owner', object: 'listing:l1' },
            ]);
            expect(result.written).toBe(1);
            const writeCall = calls.find((c) => c.url.includes('/writes'));
            expect(writeCall.body.writes.tuple_keys).toEqual([
                { user: 'user:u1', relation: 'owner', object: 'listing:l1' },
            ]);
            expect(writeCall.body.authorization_model_id).toBe('model-1');
        });

        it('no-ops on empty tuple lists', async () => {
            const calls = [];
            const service = createOpenFgaService(BASE_CONFIG, {
                fetchImpl: createFetchStub({ calls, allowedMap: {} }),
            });
            expect((await service.writeTuples([])).written).toBe(0);
            expect(calls).toHaveLength(0);
        });
    });

    describe('configuration', () => {
        it('is disabled when no API URL or store id is provided', () => {
            const service = createOpenFgaService({}, { fetchImpl: createFetchStub() });
            expect(service.isConfigured).toBe(false);
            expect(service.getEnforcementMode()).toBe('off');
        });

        it('rejects unknown enforcement modes by falling back to off', () => {
            const service = createOpenFgaService({ ...BASE_CONFIG, enforcementMode: 'yolo' }, {
                fetchImpl: createFetchStub(),
            });
            expect(service.getEnforcementMode()).toBe('off');
        });
    });
});
        it('falls back to the legacy decision when OpenFGA is unreachable', async () => {
            const service = createOpenFgaService({ ...BASE_CONFIG, enforcementMode: 'monitor' }, {
                fetchImpl: createFetchStub({ respondError: true }),
            });
            const result = await service.authorizeListingEditor({ userId: 'u1', listingId: 'l1', legacyAllowed: true });
            expect(result).toMatchObject({ allowed: true, enforced: false, fgaChecked: false });
            expect(result.fgaError).toContain('503');
        });
    });
