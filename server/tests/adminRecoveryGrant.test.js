const AdminRecoveryGrant = require('../models/AdminRecoveryGrant');
const User = require('../models/User');
const {
    consumeReservedRecoveryGrant,
    createAdminRecoveryGrant,
    exchangeAdminRecoveryGrant,
    getActiveRecoveryAuthority,
    reserveRecoveryGrant,
    revokeRecoveryGrant,
} = require('../services/adminRecoveryGrantService');

describe('admin recovery grants', () => {
    const previousSecret = process.env.ADMIN_SECURITY_HASH_SECRET;
    const previousTtl = process.env.ADMIN_RECOVERY_AUTHORITY_TTL_SECONDS;
    const previousTwoPerson = process.env.ADMIN_RECOVERY_TWO_PERSON_REQUIRED;

    beforeAll(() => {
        process.env.ADMIN_SECURITY_HASH_SECRET = 'a8F4q2L9v7X3m6K1p5R0t8W2z4N7c9B6Y1D3';
        process.env.ADMIN_RECOVERY_AUTHORITY_TTL_SECONDS = '300';
        process.env.ADMIN_RECOVERY_TWO_PERSON_REQUIRED = 'false';
    });

    afterAll(() => {
        if (previousSecret === undefined) delete process.env.ADMIN_SECURITY_HASH_SECRET;
        else process.env.ADMIN_SECURITY_HASH_SECRET = previousSecret;
        if (previousTtl === undefined) delete process.env.ADMIN_RECOVERY_AUTHORITY_TTL_SECONDS;
        else process.env.ADMIN_RECOVERY_AUTHORITY_TTL_SECONDS = previousTtl;
        if (previousTwoPerson === undefined) delete process.env.ADMIN_RECOVERY_TWO_PERSON_REQUIRED;
        else process.env.ADMIN_RECOVERY_TWO_PERSON_REQUIRED = previousTwoPerson;
    });

    beforeEach(async () => {
        await AdminRecoveryGrant.deleteMany({});
        await User.deleteMany({ email: /admin-recovery-test/ });
    });

    const createUser = (suffix) => User.create({
        name: `Recovery ${suffix}`,
        email: `admin-recovery-test-${suffix}@example.com`,
        authUid: `recovery-auth-${suffix}`,
        isAdmin: true,
        isVerified: true,
        accountState: 'active',
    });

    test('stores only hashes, exchanges once, and binds authority to subject and session', async () => {
        const user = await createUser('owner');
        const otherUser = await createUser('other');
        const { grant, plaintextToken } = await createAdminRecoveryGrant({
            user,
            operator: 'operator-one',
            ticket: 'SEC-123',
            reasonCode: 'lost_admin_factor',
            expiresInSeconds: 600,
        });

        const stored = await AdminRecoveryGrant.findById(grant._id).select('+tokenHash').lean();
        expect(stored.tokenHash).not.toBe(plaintextToken);
        expect(JSON.stringify(stored)).not.toContain(plaintextToken);

        const crossUser = await exchangeAdminRecoveryGrant({
            plaintextToken,
            user: otherUser,
            sessionId: 'other-session',
        });
        expect(crossUser).toBeNull();

        const exchanged = await exchangeAdminRecoveryGrant({
            plaintextToken,
            user,
            sessionId: 'owner-session',
        });
        expect(exchanged).toBeTruthy();
        expect(exchanged.authority).not.toBe(plaintextToken);

        const replay = await exchangeAdminRecoveryGrant({
            plaintextToken,
            user,
            sessionId: 'owner-session',
        });
        expect(replay).toBeNull();

        const wrongSession = await getActiveRecoveryAuthority({
            authority: exchanged.authority,
            user,
            sessionId: 'wrong-session',
        });
        expect(wrongSession).toBeNull();

        const active = await getActiveRecoveryAuthority({
            authority: exchanged.authority,
            user,
            sessionId: 'owner-session',
        });
        expect(active?.grantId).toBe(grant.grantId);
    });

    test('reserves only once and permanently consumes the grant', async () => {
        const user = await createUser('consume');
        const { grant, plaintextToken } = await createAdminRecoveryGrant({
            user,
            operator: 'operator-one',
            ticket: 'SEC-124',
            reasonCode: 'lost_admin_factor',
            expiresInSeconds: 600,
        });
        await exchangeAdminRecoveryGrant({ plaintextToken, user, sessionId: 'session-one' });

        const first = await reserveRecoveryGrant({ grantId: grant.grantId, user });
        const concurrent = await reserveRecoveryGrant({ grantId: grant.grantId, user });
        expect(first?.state).toBe('consuming');
        expect(concurrent).toBeNull();

        const consumed = await consumeReservedRecoveryGrant({ grantId: grant.grantId, user });
        expect(consumed?.state).toBe('consumed');
        const active = await AdminRecoveryGrant.findById(grant._id)
            .select('+authorityHash +boundSessionHash')
            .lean();
        expect(active.authorityHash).toBeUndefined();
        expect(active.boundSessionHash).toBeUndefined();
    });

    test('rejects expired grants', async () => {
        const user = await createUser('expired');
        const { plaintextToken } = await createAdminRecoveryGrant({
            user,
            operator: 'operator-one',
            ticket: 'SEC-125',
            reasonCode: 'lost_admin_factor',
            expiresInSeconds: 60,
        });
        const exchanged = await exchangeAdminRecoveryGrant({
            plaintextToken,
            user,
            sessionId: 'session-one',
            now: new Date(Date.now() + 120_000),
        });
        expect(exchanged).toBeNull();
    });

    test('revocation removes session-bound recovery authority', async () => {
        const user = await createUser('revoked');
        const { grant, plaintextToken } = await createAdminRecoveryGrant({
            user,
            operator: 'operator-one',
            ticket: 'SEC-126',
            reasonCode: 'lost_admin_factor',
            expiresInSeconds: 600,
        });
        const exchanged = await exchangeAdminRecoveryGrant({ plaintextToken, user, sessionId: 'session-one' });
        await revokeRecoveryGrant({ grantId: grant.grantId, user });

        const authority = await getActiveRecoveryAuthority({
            authority: exchanged.authority,
            user,
            sessionId: 'session-one',
        });
        expect(authority).toBeNull();
        const stored = await AdminRecoveryGrant.findById(grant._id)
            .select('+authorityHash +boundSessionHash')
            .lean();
        expect(stored.state).toBe('revoked');
        expect(stored.authorityHash).toBeUndefined();
        expect(stored.boundSessionHash).toBeUndefined();
    });

    test('enforces distinct operators when two-person recovery is required', async () => {
        process.env.ADMIN_RECOVERY_TWO_PERSON_REQUIRED = 'true';
        const user = await createUser('two-person');
        await expect(createAdminRecoveryGrant({
            user,
            operator: 'operator-one',
            secondOperator: 'operator-one',
            ticket: 'SEC-127',
            reasonCode: 'lost_admin_factor',
            expiresInSeconds: 600,
        })).rejects.toThrow('distinct second recovery operator');
        process.env.ADMIN_RECOVERY_TWO_PERSON_REQUIRED = 'false';
    });
});
