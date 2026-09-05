'use strict';

jest.mock('../config/redis', () => ({
    getRedisClient: () => null,
    flags: { redisPrefix: 'aura_test' },
}));

const {
    MAX_ACTIVE_SESSIONS_PER_USER,
    createBrowserSession,
    enforceSessionCapForUser,
    getAllTrackedSessionIdsForUser,
    loadSessionRecord,
} = require('../services/browserSessionService');

const makeUser = (tag) => ({
    _id: `cap-user-${tag}`,
    email: `${tag}@example.com`,
    name: 'Cap User',
});

const makeReq = () => ({ headers: {}, ip: '127.0.0.1' });

const createSession = (user) => createBrowserSession({ req: makeReq(), user });

// Enforcement inside persistSessionRecord is fire-and-forget by design (login
// latency), so tests drive enforceSessionCapForUser explicitly — same code.
const settleCap = (userId, keepSessionId) => enforceSessionCapForUser(userId, { keepSessionId });

describe('browser session cap (A4)', () => {
    test('default cap is a sane bound', () => {
        expect(MAX_ACTIVE_SESSIONS_PER_USER).toBeGreaterThanOrEqual(1);
        expect(MAX_ACTIVE_SESSIONS_PER_USER).toBeLessThanOrEqual(100);
    });

    test('evicts oldest sessions beyond the cap and keeps the newest', async () => {
        const user = makeUser(`evict-${Date.now()}`);
        const created = [];
        for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER + 2; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            created.push(await createSession(user));
        }
        const newest = created[created.length - 1].sessionId;
        await settleCap(user._id, newest);

        const tracked = await getAllTrackedSessionIdsForUser(user._id);
        expect(tracked).toHaveLength(MAX_ACTIVE_SESSIONS_PER_USER);
        expect(tracked).toContain(newest);
        expect(await loadSessionRecord(created[0].sessionId)).toBeNull();
        expect(await loadSessionRecord(created[1].sessionId)).toBeNull();
        expect(await loadSessionRecord(newest)).not.toBeNull();
    });

    test('other users are unaffected by the cap', async () => {
        const tag = `isolated-${Date.now()}`;
        const userA = makeUser(`${tag}-a`);
        const userB = makeUser(`${tag}-b`);
        const createdA = [];
        for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER + 1; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            createdA.push(await createSession(userA));
        }
        await settleCap(userA._id, createdA[createdA.length - 1].sessionId);
        await createSession(userB);

        expect(await getAllTrackedSessionIdsForUser(userB._id)).toHaveLength(1);
        expect(await getAllTrackedSessionIdsForUser(userA._id)).toHaveLength(MAX_ACTIVE_SESSIONS_PER_USER);
    });

    test('enforceSessionCapForUser never evicts the kept session', async () => {
        const user = makeUser(`keep-${Date.now()}`);
        const created = [];
        for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER + 1; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            created.push(await createSession(user));
        }
        const newest = created[created.length - 1].sessionId;
        const outcome = await settleCap(user._id, newest);
        expect(outcome.evicted).not.toContain(newest);
        expect(await getAllTrackedSessionIdsForUser(user._id)).toHaveLength(MAX_ACTIVE_SESSIONS_PER_USER);
        expect(await loadSessionRecord(newest)).not.toBeNull();
    });

    test('enforceSessionCapForUser is a no-op without a user', async () => {
        await expect(enforceSessionCapForUser('')).resolves.toEqual({ evicted: [] });
    });
});
