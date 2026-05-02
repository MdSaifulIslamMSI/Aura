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
const mockDnsLookup = jest.fn();

jest.mock('node-fetch', () => (...args) => mockFetch(...args));
jest.mock('dns', () => ({
    promises: {
        lookup: (...args) => mockDnsLookup(...args),
    },
}));
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
        mockDnsLookup.mockReset();
        mockBreakerCall.mockClear();
        mockBreakerStats.mockClear();
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        process.env.GEMINI_CHAT_MODEL = 'models/gemma-4-31b-it';
        process.env.GEMINI_CHAT_MODEL_FALLBACKS = 'models/gemma-4-26b-a4b-it';
        process.env.GEMINI_CHAT_MODEL_DEGRADE_MS = '180000';
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

    test('validateRemoteMediaUrl rejects localhost and metadata URLs before fetch', async () => {
        const { __testables } = require('../services/ai/geminiGatewayService');

        await expect(__testables.validateRemoteMediaUrl('http://localhost/image.png'))
            .rejects.toThrow('gemini_media_url_host_not_allowed');
        await expect(__testables.validateRemoteMediaUrl('http://169.254.169.254/latest/meta-data'))
            .rejects.toThrow('gemini_media_url_private_network');
        expect(mockDnsLookup).not.toHaveBeenCalled();
    });

    test('validateRemoteMediaUrl rejects hostnames that resolve to private addresses', async () => {
        mockDnsLookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
        const { __testables } = require('../services/ai/geminiGatewayService');

        await expect(__testables.validateRemoteMediaUrl('https://assets.example.com/photo.jpg'))
            .rejects.toThrow('gemini_media_url_private_network');
    });

    test('validateRemoteMediaUrl allows public media URLs and drops fragments', async () => {
        mockDnsLookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
        const { __testables } = require('../services/ai/geminiGatewayService');

        await expect(__testables.validateRemoteMediaUrl('https://assets.example.com/photo.jpg#secret'))
            .resolves.toBe('https://assets.example.com/photo.jpg');
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

    test('buildChatModelCandidates demotes a temporarily degraded primary model behind its fallback', () => {
        const { __testables } = require('../services/ai/geminiGatewayService');

        __testables.markModelTemporarilyDegraded('models/gemma-4-31b-it', new Error('network timeout at: model'));

        expect(__testables.buildChatModelCandidates({
            model: 'models/gemma-4-31b-it',
            fallbacks: ['models/gemma-4-26b-a4b-it'],
        }, ['models/gemma-4-31b-it', 'models/gemma-4-26b-a4b-it'])).toEqual([
            'models/gemma-4-26b-a4b-it',
            'models/gemma-4-31b-it',
        ]);
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

    test('generateStructuredJson retries a stale unhealthy health check with a forced refresh', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                text: async () => JSON.stringify({
                    error: {
                        message: 'Service temporarily unavailable',
                    },
                }),
            })
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
                            parts: [{ text: '{"answer":"Recovered"}' }],
                        },
                    }],
                }),
            });

        const { generateStructuredJson } = require('../services/ai/geminiGatewayService');
        const result = await generateStructuredJson({
            systemPrompt: 'Return JSON only.',
            prompt: 'Recover after the stale health cache.',
        });

        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(result).toMatchObject({
            data: {
                answer: 'Recovered',
            },
            provider: 'gemini',
            providerModel: 'models/gemma-4-31b-it',
        });
    });

    test('generateStructuredJson temporarily demotes the primary chat model after a timeout and uses the fallback first on the next turn', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({
                    models: [
                        { name: 'models/gemma-4-31b-it' },
                        { name: 'models/gemma-4-26b-a4b-it' },
                    ],
                }),
            })
            .mockRejectedValueOnce(new Error('network timeout at: https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent'))
            .mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({
                    candidates: [{
                        content: {
                            parts: [{ text: '{"answer":"Fallback worked"}' }],
                        },
                    }],
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({
                    candidates: [{
                        content: {
                            parts: [{ text: '{"answer":"Stayed stable"}' }],
                        },
                    }],
                }),
            });

        const { generateStructuredJson, getGeminiHealth } = require('../services/ai/geminiGatewayService');

        const first = await generateStructuredJson({
            systemPrompt: 'Return JSON only.',
            prompt: 'First turn',
        });
        const second = await generateStructuredJson({
            systemPrompt: 'Return JSON only.',
            prompt: 'Second turn',
        });

        expect(first).toMatchObject({
            data: { answer: 'Fallback worked' },
            providerModel: 'models/gemma-4-26b-a4b-it',
        });
        expect(second).toMatchObject({
            data: { answer: 'Stayed stable' },
            providerModel: 'models/gemma-4-26b-a4b-it',
        });

        const modelCallUrls = mockFetch.mock.calls
            .map((call) => call[0])
            .filter((url) => String(url).includes(':generateContent'));
        expect(modelCallUrls).toEqual([
            'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent',
            'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent',
            'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent',
        ]);
        expect(getGeminiHealth().degradedModels).toContain('models/gemma-4-31b-it');
    });
});
