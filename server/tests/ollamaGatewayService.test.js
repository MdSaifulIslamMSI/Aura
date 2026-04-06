const mockFetch = jest.fn();
const mockBreakerCall = jest.fn(async (fn) => fn());
const mockBreakerStats = jest.fn(() => ({
    name: 'ollama_gateway',
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

const makeJsonResponse = ({ ok = true, status = 200, body = {} } = {}) => ({
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

describe('ollamaGatewayService', () => {
    beforeEach(() => {
        jest.resetModules();
        mockFetch.mockReset();
        mockBreakerCall.mockClear();
        mockBreakerStats.mockClear();
        process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
        process.env.OLLAMA_CHAT_MODEL = 'gemma4:e4b';
        process.env.OLLAMA_CHAT_MODEL_FALLBACKS = 'phi3:mini';
        process.env.OLLAMA_EMBED_MODEL = 'nomic-embed-text';
    });

    afterAll(() => {
        delete process.env.OLLAMA_BASE_URL;
        delete process.env.OLLAMA_CHAT_MODEL;
        delete process.env.OLLAMA_CHAT_MODEL_FALLBACKS;
        delete process.env.OLLAMA_EMBED_MODEL;
    });

    test('retries with a fallback chat model when the preferred model cannot fit in memory', async () => {
        mockFetch
            .mockResolvedValueOnce(makeJsonResponse({
                body: {
                    models: [
                        { name: 'gemma4:e4b' },
                        { name: 'phi3:mini' },
                    ],
                },
            }))
            .mockResolvedValueOnce(makeJsonResponse({
                ok: false,
                status: 500,
                body: {
                    error: 'model requires more system memory (9.9 GiB) than is available (6.9 GiB)',
                },
            }))
            .mockResolvedValueOnce(makeJsonResponse({
                body: {
                    response: JSON.stringify({
                        answer: 'Fallback model response',
                        followUps: ['Next step'],
                    }),
                },
            }));

        const { generateStructuredJson } = require('../services/ai/ollamaGatewayService');
        const result = await generateStructuredJson({
            systemPrompt: 'Return JSON.',
            prompt: 'Say hello.',
            route: 'GENERAL',
        });

        expect(result.providerModel).toBe('phi3:mini');
        expect(result.provider).toBe('ollama');
        expect(result.data).toEqual({
            answer: 'Fallback model response',
            followUps: ['Next step'],
        });

        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(JSON.parse(mockFetch.mock.calls[1][1].body).model).toBe('gemma4:e4b');
        expect(JSON.parse(mockFetch.mock.calls[2][1].body).model).toBe('phi3:mini');
    });

    test('uses an installed fallback directly when the preferred model is unavailable', async () => {
        mockFetch
            .mockResolvedValueOnce(makeJsonResponse({
                body: {
                    models: [
                        { name: 'phi3:mini' },
                    ],
                },
            }))
            .mockResolvedValueOnce(makeJsonResponse({
                body: {
                    response: JSON.stringify({
                        answer: 'Installed fallback response',
                        followUps: ['Refine'],
                    }),
                },
            }));

        const { generateStructuredJson } = require('../services/ai/ollamaGatewayService');
        const result = await generateStructuredJson({
            systemPrompt: 'Return JSON.',
            prompt: 'Summarize this.',
            route: 'GENERAL',
        });

        expect(result.providerModel).toBe('phi3:mini');
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(JSON.parse(mockFetch.mock.calls[1][1].body).model).toBe('phi3:mini');
    });

    test('warms an installed fallback chat model without using the circuit breaker path', async () => {
        mockFetch
            .mockResolvedValueOnce(makeJsonResponse({
                body: {
                    models: [
                        { name: 'gemma4:e4b' },
                        { name: 'phi3:mini' },
                    ],
                },
            }))
            .mockResolvedValueOnce(makeJsonResponse({
                ok: false,
                status: 500,
                body: {
                    error: 'model requires more system memory (9.9 GiB) than is available (6.9 GiB)',
                },
            }))
            .mockResolvedValueOnce(makeJsonResponse({
                body: {
                    response: JSON.stringify({ ready: true }),
                },
            }));

        const { warmChatModel } = require('../services/ai/ollamaGatewayService');
        const result = await warmChatModel({ reason: 'test_suite', timeoutMs: 123_000 });

        expect(result).toEqual({
            warmed: true,
            provider: 'ollama',
            providerModel: 'phi3:mini',
            timeoutMs: 123_000,
        });
        expect(mockBreakerCall).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(JSON.parse(mockFetch.mock.calls[1][1].body).model).toBe('gemma4:e4b');
        expect(JSON.parse(mockFetch.mock.calls[2][1].body).model).toBe('phi3:mini');
    });

    test('prefers the last resolved fallback model for later chat turns', async () => {
        mockFetch
            .mockResolvedValueOnce(makeJsonResponse({
                body: {
                    models: [
                        { name: 'gemma4:e4b' },
                        { name: 'phi3:mini' },
                    ],
                },
            }))
            .mockResolvedValueOnce(makeJsonResponse({
                ok: false,
                status: 500,
                body: {
                    error: 'model requires more system memory (9.9 GiB) than is available (6.9 GiB)',
                },
            }))
            .mockResolvedValueOnce(makeJsonResponse({
                body: {
                    response: JSON.stringify({ ready: true }),
                },
            }))
            .mockResolvedValueOnce(makeJsonResponse({
                body: {
                    response: JSON.stringify({
                        answer: 'Resolved fallback reply',
                        followUps: ['Continue'],
                    }),
                },
            }));

        const { warmChatModel, generateStructuredJson } = require('../services/ai/ollamaGatewayService');
        await warmChatModel({ reason: 'test_suite' });
        const result = await generateStructuredJson({
            systemPrompt: 'Return JSON.',
            prompt: 'Say hello.',
            route: 'GENERAL',
        });

        expect(result.providerModel).toBe('phi3:mini');
        expect(JSON.parse(mockFetch.mock.calls[3][1].body).model).toBe('phi3:mini');
    });
});
