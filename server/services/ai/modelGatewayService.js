const ollamaGateway = require('./ollamaGatewayService');
const geminiGateway = require('./geminiGatewayService');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim().toLowerCase();
const uniq = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((entry) => safeString(entry)).filter(Boolean))];
const SUPPORTED_PROVIDERS = new Set(['gemini', 'ollama']);

const resolveGatewayProvider = (options = {}) => {
    const preferred = safeString(options.provider || options.preferredProvider || '');
    if (SUPPORTED_PROVIDERS.has(preferred)) {
        return preferred;
    }

    const configured = safeString(process.env.AI_MODEL_PROVIDER || '');
    if (configured === 'gemini' || configured === 'ollama') {
        return configured;
    }

    return safeString(process.env.GEMINI_API_KEY || '') ? 'gemini' : 'ollama';
};

const resolveGatewayProviders = (options = {}) => {
    const primary = resolveGatewayProvider(options);
    if (options.disableFallback || options.disableProviderFallback) {
        return [primary];
    }

    const configuredFallbacks = uniq(safeString(process.env.AI_MODEL_PROVIDER_FALLBACKS || '').split(','))
        .filter((provider) => SUPPORTED_PROVIDERS.has(provider) && provider !== primary);
    return [primary, ...configuredFallbacks];
};

const getGatewayModuleByProvider = (provider = '') => (safeString(provider) === 'gemini' ? geminiGateway : ollamaGateway);
const getGatewayModule = () => getGatewayModuleByProvider(resolveGatewayProvider());

const isRetryableProviderError = (error) => {
    const message = safeString(error?.message || '');
    const statusCode = Number(error?.statusCode || 0);
    if ([400, 401, 403].includes(statusCode)) {
        return false;
    }
    if (!message) return true;
    return !(
        message.includes('invalid_json_response')
        || message.includes('invalid_data_url')
        || message.includes('missing')
    );
};

const callProviderChain = async (operation, args = [], options = {}) => {
    const providers = resolveGatewayProviders(options);
    let lastError = null;

    for (let index = 0; index < providers.length; index += 1) {
        const provider = providers[index];
        const module = getGatewayModuleByProvider(provider);
        try {
            const result = await module[operation](...args);
            if (result && typeof result === 'object' && !Array.isArray(result)) {
                return {
                    ...result,
                    provider: result.provider || provider,
                    providerChain: providers,
                    providerFallbackUsed: index > 0,
                };
            }
            return result;
        } catch (error) {
            lastError = error;
            if (index >= providers.length - 1 || !isRetryableProviderError(error)) {
                throw error;
            }
        }
    }

    throw lastError || new Error(`model_gateway_${operation}_failed`);
};

const checkModelGatewayHealth = async (options = {}) => {
    const providers = resolveGatewayProviders(options);
    let primaryHealth = null;

    for (let index = 0; index < providers.length; index += 1) {
        const provider = providers[index];
        const health = provider === 'gemini'
            ? await geminiGateway.checkGeminiHealth(options)
            : await ollamaGateway.checkOllamaHealth(options);
        const normalizedHealth = {
            provider,
            ...health,
            providerChain: providers,
            activeProvider: provider,
            providerFallbackUsed: index > 0,
        };
        if (index === 0) {
            primaryHealth = normalizedHealth;
        }
        if (health?.healthy) {
            return normalizedHealth;
        }
    }

    return primaryHealth || {
        provider: providers[0] || resolveGatewayProvider(),
        healthy: false,
        providerChain: providers,
        activeProvider: providers[0] || resolveGatewayProvider(),
        providerFallbackUsed: false,
    };
};

const generateStructuredJson = async (options = {}) => {
    const {
        provider = '',
        preferredProvider = '',
        disableFallback = false,
        disableProviderFallback = false,
        ...payload
    } = options || {};

    return callProviderChain('generateStructuredJson', [payload], {
        provider: provider || preferredProvider,
        disableFallback: disableFallback || disableProviderFallback,
    });
};

const embedText = async (text = '', options = {}) => {
    const {
        provider = '',
        preferredProvider = '',
        disableFallback = false,
        disableProviderFallback = false,
        ...payload
    } = options || {};

    return callProviderChain('embedText', [text, payload], {
        provider: provider || preferredProvider,
        disableFallback: disableFallback || disableProviderFallback,
    });
};

const warmChatModel = async (options = {}) => {
    const {
        provider = '',
        preferredProvider = '',
        disableFallback = false,
        disableProviderFallback = false,
        ...payload
    } = options || {};

    return callProviderChain('warmChatModel', [payload], {
        provider: provider || preferredProvider,
        disableFallback: disableFallback || disableProviderFallback,
    });
};

const getGatewayConfig = () => {
    const provider = resolveGatewayProvider();
    const config = getGatewayModule().getGatewayConfig();
    return {
        provider,
        providerChain: resolveGatewayProviders(),
        ...config,
    };
};

const getModelGatewayHealth = () => {
    const providers = resolveGatewayProviders();
    const provider = providers[0] || resolveGatewayProvider();
    const health = provider === 'gemini'
        ? geminiGateway.getGeminiHealth()
        : ollamaGateway.getOllamaHealth();
    return {
        provider,
        providerChain: providers,
        activeProvider: provider,
        ...health,
    };
};

module.exports = {
    checkModelGatewayHealth,
    embedText,
    generateStructuredJson,
    getGatewayConfig,
    getModelGatewayHealth,
    getOllamaHealth: getModelGatewayHealth,
    resolveGatewayProvider,
    resolveGatewayProviders,
    warmChatModel,
};
