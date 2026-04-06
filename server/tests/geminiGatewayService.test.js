const mockFetch = jest.fn();
const mockBreakerCall = jest.fn(async (fn) => fn());
const mockBreakerStats = jest.fn(() => ({
    name: 'gemini_gateway',
    state: 'CLOSED',
    failureCount: 0,
    successCount: 0,
    lastFailureAt: null,
    openedAt: null,
}));

jest.mock('node-fetch', () => (...args) => mockFetch(...args));
jest.mock('../utils/circuitBreaker', () => ({
    getBreaker: jest.fn(() => ({
        call: mockBreakerCall,
        stats: mockBreakerStats,
    })),
}));

describe('geminiGatewayService helpers', () => {
    beforeEach(() => {
        jest.resetModules();
        mockFetch.mockReset();
        mockBreakerCall.mockClear();
        mockBreakerStats.mockClear();
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        delete process.env.GEMINI_AUDIO_MODEL;
        delete process.env.GEMINI_AUDIO_MODEL_FALLBACKS;
    });

    test('extractJsonCandidate recovers the first valid JSON object from a verbose model reply', () => {
        const { __testables } = require('../services/ai/geminiGatewayService');
        const candidate = __testables.extractJsonCandidate([
            'Here is my reasoning:',
            '1. Think about the answer.',
            '{"answer":"Hello!","confidence":1}',
        ].join('\n'));

        expect(candidate).toBe('{"answer":"Hello!","confidence":1}');
    });

    test('resolveModelCapabilities marks hosted Gemma 4 31B as text-and-image only', () => {
        const { __testables } = require('../services/ai/geminiGatewayService');

        expect(__testables.resolveModelCapabilities('models/gemma-4-31b-it')).toEqual({
            textInput: true,
            imageInput: true,
            audioInput: false,
        });
    });

    test('supportsRequestedMedia rejects audio for the hosted Gemma 4 31B model', () => {
        const { __testables } = require('../services/ai/geminiGatewayService');

        expect(__testables.supportsRequestedMedia('models/gemma-4-31b-it', {
            images: [],
            audio: [{ dataUrl: 'data:audio/wav;base64,AAA' }],
        })).toBe(false);
    });

    test('resolveModelProfile switches to the configured audio model for audio turns', () => {
        process.env.GEMINI_AUDIO_MODEL = 'models/gemma-3n-e4b-it';
        process.env.GEMINI_AUDIO_MODEL_FALLBACKS = 'models/gemma-3n-e2b-it';
        const { getGatewayConfig, __testables } = require('../services/ai/geminiGatewayService');

        expect(__testables.resolveModelProfile({
            config: getGatewayConfig(),
            images: [],
            audio: [{ dataUrl: 'data:audio/wav;base64,AAA' }],
        })).toEqual({
            type: 'audio',
            model: 'models/gemma-3n-e4b-it',
            fallbacks: ['models/gemma-3n-e2b-it'],
        });
    });

    test('resolveModelProfile auto-detects a hosted Gemma 4 audio model when it becomes available', () => {
        process.env.GEMINI_AUDIO_MODEL = 'models/gemma-3n-e4b-it';
        const { getGatewayConfig, __testables } = require('../services/ai/geminiGatewayService');

        expect(__testables.resolveModelProfile({
            config: getGatewayConfig(),
            images: [],
            audio: [{ dataUrl: 'data:audio/wav;base64,AAA' }],
            availableModels: ['models/gemma-4-e2b-it', 'models/gemma-4-31b-it'],
        })).toEqual({
            type: 'audio',
            model: 'models/gemma-4-e2b-it',
            fallbacks: [],
        });
    });

    test('resolveGatewayCapabilities reports audio support when a resolved audio model is available', () => {
        const { __testables } = require('../services/ai/geminiGatewayService');

        expect(__testables.resolveGatewayCapabilities({
            chatModel: 'models/gemma-4-31b-it',
            resolvedChatModel: 'models/gemma-4-31b-it',
            resolvedAudioModel: 'models/gemma-4-e4b-it',
        })).toEqual({
            textInput: true,
            imageInput: true,
            audioInput: true,
        });
    });

    test('generateStructuredJson forwards responseJsonSchema to Gemini', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({
                    models: [{ name: 'models/gemma-4-31b-it' }],
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({
                    candidates: [{
                        content: {
                            parts: [{ text: '{"answer":"Ready","followUps":["Next"]}' }],
                        },
                    }],
                }),
            });

        const { generateStructuredJson } = require('../services/ai/geminiGatewayService');
        const responseJsonSchema = {
            type: 'object',
            properties: {
                answer: { type: 'string' },
            },
            required: ['answer'],
        };

        const result = await generateStructuredJson({
            systemPrompt: 'Return JSON only.',
            prompt: 'Say ready.',
            responseJsonSchema,
        });

        const requestBody = JSON.parse(mockFetch.mock.calls[1][1].body);
        expect(requestBody.generationConfig.responseMimeType).toBe('application/json');
        expect(requestBody.generationConfig.responseJsonSchema).toEqual(responseJsonSchema);
        expect(result).toMatchObject({
            data: {
                answer: 'Ready',
                followUps: ['Next'],
            },
            provider: 'gemini',
            providerModel: 'models/gemma-4-31b-it',
        });
    });
});
