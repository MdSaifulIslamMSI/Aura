describe('account browser-session inventory', () => {
    const originalEnv = { ...process.env };

    const loadService = () => {
        let browserSessionService;
        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'trusted-device-private-id',
                }),
            }));
            browserSessionService = require('../services/browserSessionService');
        });
        return browserSessionService;
    };

    const createUser = (id, email) => ({
        _id: id,
        email,
        name: 'Session User',
        phone: '+919876543210',
        isAdmin: false,
        isSeller: false,
        isVerified: true,
        authAssurance: 'password+otp',
    });

    const createSession = (service, user, { userAgent, authUid }) => service.createBrowserSession({
        req: {
            ip: '203.0.113.42',
            headers: {
                host: 'localhost:5173',
                'user-agent': userAgent,
                cookie: 'non_auth_cookie=session-cookie-sentinel',
                'x-device-fingerprint': 'device-fingerprint-sentinel',
            },
            secure: false,
        },
        user,
        authUid,
        authToken: {
            email: user.email,
            email_verified: true,
            name: user.name,
            phone_number: user.phone,
            firebase: { sign_in_provider: 'password' },
        },
        additionalAmr: ['otp'],
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('returns a bounded public projection without raw session or identity secrets', async () => {
        const service = loadService();
        const user = createUser('507f1f77bcf86cd799439101', 'session-owner@example.com');
        const current = await createSession(service, user, {
            authUid: 'firebase-session-owner',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        });
        await createSession(service, user, {
            authUid: 'firebase-session-owner',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile Safari/604.1',
        });

        const sessions = await service.listBrowserSessionsForUser(user._id, {
            currentSessionId: current.sessionId,
            limit: 20,
        });

        expect(sessions).toHaveLength(2);
        expect(sessions[0]).toMatchObject({
            current: true,
            client: 'Chrome',
            os: 'Windows',
        });
        expect(sessions[0].id).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(Object.keys(sessions[0]).sort()).toEqual([
            'client',
            'createdAt',
            'current',
            'expiresAt',
            'id',
            'lastActiveAt',
            'os',
        ]);

        const serialized = JSON.stringify(sessions);
        expect(serialized).not.toContain(current.sessionId);
        expect(serialized).not.toContain(user._id);
        expect(serialized).not.toContain(user.email);
        expect(serialized).not.toContain(user.phone);
        expect(serialized).not.toContain('trusted-device-private-id');
        expect(serialized).not.toContain('firebase-session-owner');
        expect(serialized).not.toContain('otp');
        expect(serialized).not.toContain('Mozilla/5.0');
        expect(serialized).not.toContain('203.0.113.42');
        expect(serialized).not.toContain('session-cookie-sentinel');
        expect(serialized).not.toContain('device-fingerprint-sentinel');
        expect(serialized).not.toContain('{test:auth}:session:');
    });

    test('resolves a public alias only inside the authenticated user inventory', async () => {
        const service = loadService();
        const owner = createUser('507f1f77bcf86cd799439102', 'session-owner-2@example.com');
        const other = createUser('507f1f77bcf86cd799439103', 'session-other@example.com');
        const ownerSession = await createSession(service, owner, {
            authUid: 'firebase-session-owner-2',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36',
        });
        const otherSession = await createSession(service, other, {
            authUid: 'firebase-session-other',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Version/17.5 Safari/605.1.15',
        });
        const [otherPublicSession] = await service.listBrowserSessionsForUser(other._id);

        await expect(service.revokeBrowserSessionForUserByPublicId(
            owner._id,
            otherPublicSession.id
        )).resolves.toBeNull();
        await expect(service.getBrowserSession(ownerSession.sessionId)).resolves.toBeTruthy();
        await expect(service.getBrowserSession(otherSession.sessionId)).resolves.toBeTruthy();

        const [ownerPublicSession] = await service.listBrowserSessionsForUser(owner._id, {
            currentSessionId: ownerSession.sessionId,
        });
        await expect(service.revokeBrowserSessionForUserByPublicId(
            owner._id,
            ownerPublicSession.id,
            { currentSessionId: ownerSession.sessionId }
        )).resolves.toEqual({ revoked: true, current: true });
        await expect(service.getBrowserSession(ownerSession.sessionId)).resolves.toBeNull();
        await expect(service.getBrowserSession(otherSession.sessionId)).resolves.toBeTruthy();
    });

    test('revokes other sessions while preserving the current session and other users', async () => {
        const service = loadService();
        const owner = createUser('507f1f77bcf86cd799439104', 'session-owner-3@example.com');
        const other = createUser('507f1f77bcf86cd799439105', 'session-other-3@example.com');
        const current = await createSession(service, owner, {
            authUid: 'firebase-session-owner-3',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36',
        });
        const stale = await createSession(service, owner, {
            authUid: 'firebase-session-owner-3',
            userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36',
        });
        const otherSession = await createSession(service, other, {
            authUid: 'firebase-session-other-3',
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/127.0',
        });

        await expect(service.revokeOtherBrowserSessionsForUser(
            owner._id,
            current.sessionId
        )).resolves.toEqual({ revoked: 1 });

        await expect(service.getBrowserSession(current.sessionId)).resolves.toBeTruthy();
        await expect(service.getBrowserSession(stale.sessionId)).resolves.toBeNull();
        await expect(service.getBrowserSession(otherSession.sessionId)).resolves.toBeTruthy();
    });

    test('keeps the public list bounded but revokes every tracked non-current session', async () => {
        const service = loadService();
        const owner = createUser('507f1f77bcf86cd799439106', 'session-owner-4@example.com');
        const current = await createSession(service, owner, {
            authUid: 'firebase-session-owner-4',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36',
        });
        const otherSessionIds = [];

        for (let index = 0; index < 101; index += 1) {
            const session = await createSession(service, owner, {
                authUid: 'firebase-session-owner-4',
                userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36',
            });
            otherSessionIds.push(session.sessionId);
        }

        await expect(service.listBrowserSessionsForUser(owner._id, {
            currentSessionId: current.sessionId,
            limit: 20,
        })).resolves.toHaveLength(20);
        await expect(service.revokeOtherBrowserSessionsForUser(
            owner._id,
            current.sessionId
        )).resolves.toEqual({ revoked: 101 });

        await expect(service.getBrowserSession(current.sessionId)).resolves.toBeTruthy();
        await expect(service.getBrowserSession(otherSessionIds[100])).resolves.toBeNull();
    });
});
