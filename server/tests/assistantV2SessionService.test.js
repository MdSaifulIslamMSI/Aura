jest.mock('../config/redis', () => ({
    flags: {
        redisPrefix: 'aura-test',
    },
    getRedisClient: jest.fn().mockReturnValue(null),
}));

jest.mock('../config/assistantFlags', () => ({
    flags: {
        assistantV2SessionTtlSeconds: 1,
    },
}));

const {
    __resetAssistantSessionsForTests,
    createEmptySession,
    resolveAssistantSession,
    saveAssistantSession,
    loadAssistantSession,
} = require('../services/assistantV2/assistantSessionService');

describe('assistantV2SessionService', () => {
    beforeEach(() => {
        __resetAssistantSessionsForTests();
        jest.useRealTimers();
    });

    test('creates a new session when none exists', async () => {
        const session = await resolveAssistantSession('');

        expect(session.id).toBeTruthy();
        expect(session.turnCount).toBe(0);
        expect(session.lastIntent).toBe('general_help');
    });

    test('persists and reloads a session with fallback memory storage', async () => {
        const base = createEmptySession('session-123');
        await saveAssistantSession({
            ...base,
            turnCount: 3,
            lastIntent: 'product_search',
        }, 60);

        const loaded = await loadAssistantSession('session-123');
        expect(loaded.turnCount).toBe(3);
        expect(loaded.lastIntent).toBe('product_search');
    });
});
