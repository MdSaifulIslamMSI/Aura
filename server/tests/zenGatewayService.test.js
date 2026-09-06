const mockFetch = jest.fn();
const mockBreakerCall = jest.fn(async (fn) => fn());
const mockBreakerStats = jest.fn(() => ({
    name: 'zen_gateway',
    state: 'CLOSED',
    failureCount: 0,
    successCount: 0,
    lastFailureAt: null,
    openedAt: null,
}));

jest.mock('../utils/circuitBreaker', () => ({
    getBreaker: jest.fn(() => ({
        call: mockBreakerCall,
        stats: mockBreakerStats,
    })),
}));

describe('zenGatewayService', () => {
    beforeEach(() => {
        jest.resetModules();
        globalThis.fetch = mockFetch;
        mockFetch.mockReset();
        mockBreakerCall.mockClear();
        mockBreakerStats.mockClear();
        delete process.env.ZEN_API_KEY;
        delete process.env.OPENCODE_API_KEY;
        delete process.env.ZEN_BASE_URL;
        delete process.env.ZEN_CHAT_MODEL;
        delete process.env.ZEN_CHAT_MODEL_FALLBACKS;
        delete process.env.ZEN_TIMEOUT_MS;
    });

    test('extractJsonCandidate recovers the first valid JSON object from a verbose model reply', () => {
        const { __testables } = require('../services/ai/zenGatewayService');
        const candidate = __testables.extractJsonCandidate([
            'Here is my reasoning:',
            '1. Think about the answer.',
            '{"answer":"Hello!","confidence":1}',
        ].join('\n'));

        expect(candidate).toBe('{"answer":"Hello!","confidence":1}');
    });

    test('generateStructuredJson parses Responses API output and reports the zen provider', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({
                status: 'completed',
                output: [
                    { type: 'reasoning' },
                    {
                        type: 'message',
                        content: [{ type: 'output_text', text: '{"answer":"Ready","followUps":["Next"]}' }],
                    },
                ],
            }),
        });

        const { generateStructuredJson } = require('../services/ai/zenGatewayService');
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
            route: 'GENERAL',
            responseJsonSchema,
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toBe('https://opencode.ai/zen/v1/responses');
        expect(options.headers.Authorization).toBeUndefined();
        const requestBody = JSON.parse(options.body);
        expect(requestBody.model).toBe('muse-spark-1.3-contributor-free');
        expect(requestBody.instructions).toContain('Return JSON only.');
        expect(requestBody.instructions).toContain('"answer"');
        expect(requestBody.input).toBe('Say ready.');
        expect(result).toMatchObject({
            data: {
                answer: 'Ready',
                followUps: ['Next'],
            },
            provider: 'zen',
            providerModel: 'muse-spark-1.3-contributor-free',
            route: 'GENERAL',
        });
    });

    test('generateStructuredJson sends a bearer token when an API key is configured', async () => {
        process.env.ZEN_API_KEY = 'test-zen-key';
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({
                output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
            }),
        });

        const { generateStructuredJson } = require('../services/ai/zenGatewayService');
        await generateStructuredJson({ prompt: 'hi' });

        const [, options] = mockFetch.mock.calls[0];
        expect(options.headers.Authorization).toBe('Bearer test-zen-key');
    });

    test('generateStructuredJson rejects media turns instead of answering text-only', async () => {
        const { generateStructuredJson } = require('../services/ai/zenGatewayService');

        await expect(generateStructuredJson({
            prompt: 'describe this',
            images: [{ dataUrl: 'data:image/png;base64,AAA' }],
        })).rejects.toThrow('zen_media_unsupported');
        expect(mockFetch).not.toHaveBeenCalled();
    });

    test('generateStructuredJson throws a structured-parse error for non-JSON replies', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({
                output: [{ type: 'message', content: [{ type: 'output_text', text: 'I cannot answer that.' }] }],
            }),
        });

        const { generateStructuredJson } = require('../services/ai/zenGatewayService');
        await expect(generateStructuredJson({ prompt: 'hi' }))
            .rejects.toThrow('zen_invalid_structured_payload');
    });

    test('checkZenHealth lists models from the OpenAI-style payload without an API key', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({
                object: 'list',
                data: [{ id: 'muse-spark-1.3-contributor-free' }, { id: 'some-other-model' }],
            }),
        });

        const { checkZenHealth } = require('../services/ai/zenGatewayService');
        const health = await checkZenHealth({ force: true });

        expect(mockFetch.mock.calls[0][0]).toBe('https://opencode.ai/zen/v1/models');
        expect(health.healthy).toBe(true);
        expect(health.apiConfigured).toBe(false);
        expect(health.availableModels).toContain('muse-spark-1.3-contributor-free');
        expect(health.capabilities).toEqual({ textInput: true, imageInput: false, audioInput: false });
    });

    test('checkZenHealth reports unhealthy when the models endpoint is unreachable', async () => {
        mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

        const { checkZenHealth } = require('../services/ai/zenGatewayService');
        const health = await checkZenHealth({ force: true });

        expect(health.healthy).toBe(false);
        expect(health.error).toBe('connect ECONNREFUSED');
    });

    test('embedText fails loud so retrieval falls back to lexical search', async () => {
        const { embedText } = require('../services/ai/zenGatewayService');

        await expect(embedText('hello')).rejects.toThrow('zen_embeddings_unsupported');
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
