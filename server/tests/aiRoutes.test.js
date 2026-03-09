const request = require('supertest');

jest.mock('../services/ai/assistantOrchestratorService', () => ({
    processAssistantTurn: jest.fn().mockResolvedValue({
        answer: 'Top grounded answer',
        products: [],
        actions: [],
        followUps: ['Compare products'],
        grounding: {
            mode: 'chat',
            actionType: 'assistant',
        },
        provider: 'local',
        latencyMs: 12,
    }),
    createVoiceSessionConfig: jest.fn().mockReturnValue({
        sessionId: 'voice_test_123',
        expiresAt: '2026-03-09T12:00:00.000Z',
        locale: 'en-IN',
        supportsServerInterpretation: true,
        turnEndpoint: '/api/ai/chat',
        capabilities: {
            speechToText: {
                provider: 'browser_fallback',
                mode: 'browser_fallback',
                languageHints: ['en-IN', 'hi-IN'],
            },
            textToSpeech: {
                provider: 'browser_fallback',
                mode: 'browser_fallback',
                voiceId: 'alloy',
            },
        },
    }),
}));

const app = require('../index');

describe('AI Routes', () => {
    test('POST /api/ai/chat works without auth', async () => {
        const res = await request(app)
            .post('/api/ai/chat')
            .send({
                message: 'compare phones under 50000',
                assistantMode: 'chat',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.answer).toBe('Top grounded answer');
        expect(res.body.provider).toBe('local');
        expect(res.body.grounding).toMatchObject({
            mode: 'chat',
            actionType: 'assistant',
        });
    });

    test('POST /api/ai/voice/session returns voice session config', async () => {
        const res = await request(app)
            .post('/api/ai/voice/session')
            .send({
                locale: 'en-IN',
            });

        expect(res.statusCode).toBe(201);
        expect(res.body.sessionId).toBe('voice_test_123');
        expect(res.body.turnEndpoint).toBe('/api/ai/chat');
        expect(res.body.capabilities.speechToText.provider).toBe('browser_fallback');
    });
});
