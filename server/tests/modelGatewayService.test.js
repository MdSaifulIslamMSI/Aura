jest.mock('../services/ai/geminiGatewayService', () => ({
    checkGeminiHealth: jest.fn(),
    embedText: jest.fn(),
    generateStructuredJson: jest.fn(),
    getGatewayConfig: jest.fn(() => ({ provider: 'gemini', chatModel: 'models/gemma-4-31b-it' })),
    getGeminiHealth: jest.fn(() => ({ provider: 'gemini', healthy: false })),
    warmChatModel: jest.fn(),
}));

jest.mock('../services/ai/ollamaGatewayService', () => ({
    checkOllamaHealth: jest.fn(),
    embedText: jest.fn(),
    generateStructuredJson: jest.fn(),
    getGatewayConfig: jest.fn(() => ({ provider: 'ollama', chatModel: 'phi3:mini' })),
    getOllamaHealth: jest.fn(() => ({ provider: 'ollama', healthy: true })),
    warmChatModel: jest.fn(),
}));

describe('modelGatewayService', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.AI_MODEL_PROVIDER = 'gemini';
        process.env.AI_MODEL_PROVIDER_FALLBACKS = 'ollama';
    });

    afterEach(() => {
        delete process.env.AI_MODEL_PROVIDER;
        delete process.env.AI_MODEL_PROVIDER_FALLBACKS;
    });

    test('resolveGatewayProviders includes configured fallback providers', () => {
        const { resolveGatewayProviders } = require('../services/ai/modelGatewayService');

        expect(resolveGatewayProviders()).toEqual(['gemini', 'ollama']);
    });

    test('generateStructuredJson falls back to the next provider when the primary fails', async () => {
        const geminiGateway = require('../services/ai/geminiGatewayService');
        const ollamaGateway = require('../services/ai/ollamaGatewayService');
        geminiGateway.generateStructuredJson.mockRejectedValueOnce(new Error('temporary outage'));
        ollamaGateway.generateStructuredJson.mockResolvedValueOnce({
            data: { answer: 'Fallback answer' },
            provider: 'ollama',
            providerModel: 'phi3:mini',
            route: 'GENERAL',
        });

        const { generateStructuredJson } = require('../services/ai/modelGatewayService');
        const result = await generateStructuredJson({ prompt: 'hello' });

        expect(result.provider).toBe('ollama');
        expect(result.providerFallbackUsed).toBe(true);
        expect(result.providerChain).toEqual(['gemini', 'ollama']);
    });

    test('generateStructuredJson can force hosted Gemma without provider fallback', async () => {
        const geminiGateway = require('../services/ai/geminiGatewayService');
        const ollamaGateway = require('../services/ai/ollamaGatewayService');
        geminiGateway.generateStructuredJson.mockRejectedValueOnce(new Error('temporary outage'));

        const { generateStructuredJson } = require('../services/ai/modelGatewayService');

        await expect(generateStructuredJson({
            prompt: 'show me laptops',
            provider: 'gemini',
            disableProviderFallback: true,
        })).rejects.toThrow('temporary outage');

        expect(ollamaGateway.generateStructuredJson).not.toHaveBeenCalled();
    });
});
