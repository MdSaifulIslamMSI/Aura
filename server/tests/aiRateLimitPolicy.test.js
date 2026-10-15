const originalEnv = { ...process.env };

const passThrough = (_req, _res, next) => next();

const loadAiRoutesWithEnv = (env = {}) => {
    jest.resetModules();
    process.env = {
        ...originalEnv,
        ...env,
    };

    const createDistributedRateLimit = jest.fn(() => passThrough);
    jest.doMock('../middleware/distributedRateLimit', () => ({
        createDistributedRateLimit,
    }));
    jest.doMock('../middleware/authMiddleware', () => ({
        protect: passThrough,
        protectOptional: passThrough,
        requireActiveAccount: passThrough,
    }));
    jest.doMock('../controllers/aiController', () => ({
        createAiVoiceSession: jest.fn(),
        handleAiChat: jest.fn(),
        handleAiChatStream: jest.fn(),
        synthesizeAiVoiceReply: jest.fn(),
    }));
    jest.doMock('../controllers/aiSessionController', () => ({
        listAiSessions: jest.fn(),
        getAiSession: jest.fn(),
        createAiSession: jest.fn(),
        resetAiSession: jest.fn(),
        archiveAiSession: jest.fn(),
    }));

    // routes/aiRoutes reaches the trust fabric, which loads healthService ->
    // socketService -> config/firebase. Under NODE_ENV=production that module
    // calls process.exit(1) when no Admin credential is present, which killed
    // the entire jest process and took every other suite in the nightly shard
    // with it - reported as 43 unrelated test failures across unrelated
    // domains. Locally this passed only because a developer's .env happens to
    // supply credentials, so CI (which has none) was the only place it broke.
    //
    // This suite asserts rate-limit policy, not Firebase. Stub the one member
    // socketService actually uses (socketService.js:204, lazily at call time).
    jest.doMock('../config/firebase', () => ({
        auth: () => ({ verifyIdToken: jest.fn() }),
    }));

    require('../routes/aiRoutes');
    return createDistributedRateLimit;
};

describe('AI rate-limit policy', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
        jest.clearAllMocks();
        jest.dontMock('../middleware/distributedRateLimit');
        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../controllers/aiController');
        jest.dontMock('../controllers/aiSessionController');
        jest.dontMock('../config/firebase');
    });

    test('production AI limiters fail closed instead of using in-memory fallback', () => {
        const createDistributedRateLimit = loadAiRoutesWithEnv({
            NODE_ENV: 'production',
        });

        for (const name of ['ai_chat', 'ai_voice_session', 'ai_voice_speak', 'ai_sessions']) {
            expect(createDistributedRateLimit).toHaveBeenCalledWith(expect.objectContaining({
                allowInMemoryFallback: false,
                name,
                securityCritical: true,
            }));
        }
    });

    test('non-production AI limiters preserve local memory fallback', () => {
        const createDistributedRateLimit = loadAiRoutesWithEnv({
            NODE_ENV: 'development',
        });

        for (const name of ['ai_chat', 'ai_voice_session', 'ai_voice_speak', 'ai_sessions']) {
            expect(createDistributedRateLimit).toHaveBeenCalledWith(expect.objectContaining({
                allowInMemoryFallback: true,
                name,
                securityCritical: true,
            }));
        }
    });
});
