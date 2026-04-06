const request = require('supertest');

jest.mock('../services/ai/commerceAssistantService', () => ({
    processAssistantTurn: jest.fn().mockResolvedValue({
        answer: 'Top grounded answer',
        products: [],
        actions: [],
        followUps: ['Compare products'],
        assistantTurn: {
            intent: 'general_knowledge',
            entities: {
                query: '',
                productId: '',
                productIds: [],
                quantity: 0,
                priceMin: 0,
                priceMax: 0,
                category: '',
                page: '',
                orderId: '',
                supportCategory: '',
                operation: '',
                compareTerms: [],
            },
            confidence: 0.88,
            decision: 'respond',
            response: 'Top grounded answer',
            actions: [],
            ui: { surface: 'plain_answer' },
            contextPatch: {},
            followUps: ['Compare products'],
            safetyFlags: [],
        },
        grounding: {
            mode: 'chat',
            actionType: 'assistant',
        },
        provider: 'local',
        latencyMs: 12,
    }),
    streamAssistantTurn: jest.fn().mockImplementation(async ({ writeEvent }) => {
        writeEvent('message_meta', {
            sessionId: 'client-session-1',
            messageId: 'client-message-1',
            decision: 'HYBRID',
            provisional: true,
            upgradeEligible: true,
            traceId: 'trace_stream',
        });
        writeEvent('token', {
            sessionId: 'client-session-1',
            messageId: 'client-message-1',
            text: 'Top ',
        });
        writeEvent('final_turn', {
            answer: 'Top grounded answer',
            assistantTurn: {
                intent: 'general_knowledge',
                decision: 'respond',
                response: 'Top grounded answer',
                ui: { surface: 'plain_answer' },
                followUps: ['Compare products'],
            },
            decision: 'HYBRID',
            provisional: true,
            upgradeEligible: true,
            sessionId: 'client-session-1',
            messageId: 'client-message-1',
            traceId: 'trace_stream',
        });
    }),
}));

jest.mock('../services/ai/providerRegistry', () => ({
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
    synthesizeSpeech: jest.fn().mockResolvedValue({
        provider: 'elevenlabs',
        model: 'eleven_flash_v2_5',
        voiceId: 'voice_test',
        mimeType: 'audio/mpeg',
        audioBase64: 'ZmFrZQ==',
    }),
}));

const app = require('../index');
const { processAssistantTurn, streamAssistantTurn } = require('../services/ai/commerceAssistantService');

describe('AI Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

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
        expect(res.body.assistantTurn).toMatchObject({
            intent: 'general_knowledge',
            decision: 'respond',
            response: 'Top grounded answer',
        });
        expect(res.body.grounding).toMatchObject({
            mode: 'chat',
            actionType: 'assistant',
        });
    });

    test('POST /api/ai/chat accepts backend-owned action requests without a message', async () => {
        const res = await request(app)
            .post('/api/ai/chat')
            .send({
                actionRequest: {
                    type: 'checkout',
                },
                assistantMode: 'chat',
            });

        expect(res.statusCode).toBe(200);
        expect(processAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({
            message: '',
            actionRequest: {
                type: 'checkout',
            },
        }));
    });

    test('POST /api/ai/chat/stream emits message metadata and final turn events', async () => {
        const res = await request(app)
            .post('/api/ai/chat/stream')
            .send({
                message: 'hello',
                assistantMode: 'chat',
                context: {
                    clientSessionId: 'client-session-1',
                    clientMessageId: 'client-message-1',
                },
            });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        expect(res.text).toContain('event: message_meta');
        expect(res.text).toContain('"decision":"HYBRID"');
        expect(res.text).toContain('event: final_turn');
        expect(streamAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({
            message: 'hello',
        }));
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

    test('POST /api/ai/voice/speak returns synthesized audio payload', async () => {
        const res = await request(app)
            .post('/api/ai/voice/speak')
            .send({
                text: 'Hello from Aura',
                locale: 'en-IN',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.provider).toBe('elevenlabs');
        expect(res.body.audioBase64).toBe('ZmFrZQ==');
    });
});
