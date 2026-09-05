'use strict';

jest.mock('../config/redis', () => ({
    getRedisClient: () => null,
    flags: { redisPrefix: 'aura_test' },
}));

const {
    createBrowserSession,
    downgradeSiblingStepUp,
    loadSessionRecord,
} = require('../services/browserSessionService');
const { __getBufferedEvents, __resetBufferedEvents } = require('../security/securityEventLogger');

const makeUser = (tag) => ({
    _id: `stepdown-user-${tag}`,
    email: `${tag}@example.com`,
    name: 'Stepdown User',
});

const makeReq = () => ({ headers: {}, ip: '127.0.0.1' });

const futureStepUp = () => new Date(Date.now() + 10 * 60 * 1000);

const createSteppedUpSession = (user) => createBrowserSession({
    req: makeReq(),
    user,
    stepUpUntil: futureStepUp(),
});

describe('browser session step-down (A5)', () => {
    beforeEach(() => {
        __resetBufferedEvents();
    });

    afterEach(() => {
        __resetBufferedEvents();
    });

    test('clears step-up on siblings and keeps the triggering session', async () => {
        const user = makeUser(`down-${Date.now()}`);
        const first = await createSteppedUpSession(user);
        const second = await createSteppedUpSession(user);
        const current = await createSteppedUpSession(user);

        const outcome = await downgradeSiblingStepUp({
            userId: user._id,
            exceptSessionId: current.sessionId,
            reason: 'totp_verify_failed',
        });

        expect(outcome.downgraded.sort()).toEqual([first.sessionId, second.sessionId].sort());
        expect((await loadSessionRecord(first.sessionId)).stepUpUntil).toBeNull();
        expect((await loadSessionRecord(second.sessionId)).stepUpUntil).toBeNull();
        const kept = await loadSessionRecord(current.sessionId);
        expect(new Date(kept.stepUpUntil).getTime()).toBeGreaterThan(Date.now());

        const telemetry = __getBufferedEvents().filter((e) => e.event === 'auth.session.step_down');
        expect(telemetry.length).toBe(1);
        expect(telemetry[0]).toMatchObject({ decision: 'DEGRADE', reasonCode: 'sibling_step_up_cleared' });
    });

    test('is a no-op when no sibling holds step-up assurance', async () => {
        const user = makeUser(`quiet-${Date.now()}`);
        await createBrowserSession({ req: makeReq(), user });

        const outcome = await downgradeSiblingStepUp({ userId: user._id, reason: 'totp_verify_failed' });

        expect(outcome).toEqual({ downgraded: [] });
        expect(__getBufferedEvents().filter((e) => e.event === 'auth.session.step_down')).toHaveLength(0);
    });

    test('is a no-op without a user and never throws', async () => {
        await expect(downgradeSiblingStepUp({})).resolves.toEqual({ downgraded: [] });
        await expect(downgradeSiblingStepUp({ userId: '', exceptSessionId: 'x' })).resolves.toEqual({ downgraded: [] });
    });
});
