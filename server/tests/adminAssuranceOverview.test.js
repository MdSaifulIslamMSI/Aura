'use strict';

jest.mock('../config/redis', () => ({
    getRedisClient: () => null,
    flags: { redisPrefix: 'aura_test' },
}));

const User = require('../models/User');
const { createBrowserSession } = require('../services/browserSessionService');
const {
    resolveUserAssuranceOverview,
} = require('../services/adminAssuranceOverviewService');

const uniqueEmail = (tag) => `assurance-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

describe('adminAssuranceOverviewService', () => {
    const originalOutboxFlag = process.env.AUTH_SECURITY_OUTBOX_ENABLED;

    beforeEach(() => {
        process.env.AUTH_SECURITY_OUTBOX_ENABLED = 'true';
    });

    afterEach(() => {
        if (originalOutboxFlag === undefined) delete process.env.AUTH_SECURITY_OUTBOX_ENABLED;
        else process.env.AUTH_SECURITY_OUTBOX_ENABLED = originalOutboxFlag;
    });

    test('aggregates posture across sessions, factors, devices, lockout, and events', async () => {
        const user = await User.create({
            name: 'Assurance User',
            email: uniqueEmail('full'),
            phone: '9876543210',
            isVerified: true,
            isAdmin: true,
            trustedDevices: [
                { deviceId: 'device-a1', publicKeySpkiBase64: 'ZHVtbXkta2V5LTE=' },
                { deviceId: 'device-a2', publicKeySpkiBase64: 'ZHVtbXkta2V5LTI=' },
            ],
            mfa: {
                totp: { enabled: true, confirmedAt: new Date() },
                passkeys: [{ credentialId: 'cred-1' }, { credentialId: 'cred-2', revokedAt: new Date() }],
            },
            recoveryCodeState: { activeCount: 3 },
        });

        await createBrowserSession({
            req: { headers: {}, ip: '127.0.0.1' },
            user,
            stepUpUntil: new Date(Date.now() + 10 * 60 * 1000),
        });
        await createBrowserSession({ req: { headers: {}, ip: '127.0.0.1' }, user });

        const overview = await resolveUserAssuranceOverview({ userId: String(user._id) });

        expect(overview.user).toMatchObject({ id: String(user._id), isAdmin: true, isVerified: true });
        expect(overview.user.email).toMatch(/^as\*\*\*@example\.com$/);
        expect(overview.user).not.toHaveProperty('password');
        expect(overview.mfa).toMatchObject({ totpEnabled: true, passkeys: 1, recoveryCodes: 3 });
        expect(overview.trustedDevices).toBe(2);
        expect(overview.sessions.tracked).toBe(2);
        expect(overview.sessions.steppedUp).toBe(1);
        expect(overview.lockout).toMatchObject({ locked: false });
        expect(Array.isArray(overview.recentEvents)).toBe(true);
    });

    test('reports an empty posture for a fresh user', async () => {
        const user = await User.create({
            name: 'Fresh User',
            email: uniqueEmail('fresh'),
            isVerified: true,
        });

        const overview = await resolveUserAssuranceOverview({ userId: String(user._id) });

        expect(overview.mfa).toMatchObject({ totpEnabled: false, passkeys: 0, recoveryCodes: 0 });
        expect(overview.trustedDevices).toBe(0);
        expect(overview.sessions.tracked).toBe(0);
        expect(overview.sessions.steppedUp).toBe(0);
        expect(overview.lockout.locked).toBe(false);
        expect(overview.recentEvents).toEqual([]);
    });

    test('rejects invalid and unknown user ids without leaking', async () => {
        await expect(resolveUserAssuranceOverview({ userId: 'not-an-id' })).rejects.toMatchObject({ statusCode: 404 });
        await expect(
            resolveUserAssuranceOverview({ userId: '000000000000000000000000' })
        ).rejects.toMatchObject({ statusCode: 404 });
        await expect(resolveUserAssuranceOverview({})).rejects.toMatchObject({ statusCode: 404 });
    });
});
