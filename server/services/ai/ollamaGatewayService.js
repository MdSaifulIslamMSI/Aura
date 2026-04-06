const fetch = require('node-fetch');
const { getBreaker } = require('../../utils/circuitBreaker');
const logger = require('../../utils/logger');

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_CHAT_MODEL = 'gemma4:e4b';
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_CHAT_MODEL_FALLBACKS = [];
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_KEEP_ALIVE = '15m';
const HEALTH_CACHE_MS = 20_000;

const breaker = getBreaker('ollama_gateway', {
    failureThreshold: 4,
    successThreshold: 2,
    cooldownMs: 20_000,
    callTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
});

const healthState = {
    healthy: null,
    checkedAt: 0,
    error: '',
    availableModels: [],
    baseUrl: '',
    chatModel: '',
    chatModelFallbacks: [],
    embedModel: '',
    resolvedChatModel: '',
    keepAlive: '',
};

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const toPositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const uniq = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((value) => safeString(value)).filter(Boolean))];
const parseModelList = (value, fallback = []) => {
    const source = safeString(value);
    if (!source) return uniq(fallback);
    return uniq(source.split(',').map((entry) => safeString(entry)));
};

const getGatewayConfig = () => ({
    baseUrl: safeString(process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    chatModel: safeString(process.env.OLLAMA_CHAT_MODEL || DEFAULT_CHAT_MODEL),
    chatModelFallbacks: parseModelList(process.env.OLLAMA_CHAT_MODEL_FALLBACKS, DEFAULT_CHAT_MODEL_FALLBACKS),
    embedModel: safeString(process.env.OLLAMA_EMBED_MODEL || DEFAULT_EMBED_MODEL),
    timeoutMs: toPositiveNumber(process.env.OLLAMA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    keepAlive: safeString(process.env.OLLAMA_KEEP_ALIVE || DEFAULT_KEEP_ALIVE),
});

const updateHealthState = (patch = {}) => {
    Object.assign(healthState, patch, {
        checkedAt: Date.now(),
    });
};

const parseJsonResponse = async (response) => {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (error) {
        throw Object.assign(new Error('ollama_invalid_json_response'), {
            cause: error,
            rawResponse: text.slice(0, 500),
        });
    }
};

const performOllamaHttpRequest = async (url, {
    method = 'POST',
    body = undefined,
    timeoutMs,
} = {}) => fetch(url, {
    method,
    headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeout: timeoutMs,
});

const executeOllamaRequest = async (path, {
    method = 'POST',
    body = undefined,
    timeoutMs,
} = {}) => {
    const config = getGatewayConfig();
    const url = `${config.baseUrl}${path}`;
    const effectiveTimeoutMs = toPositiveNumber(timeoutMs, config.timeoutMs);

    return breaker.call(async () => {
        const response = await performOllamaHttpRequest(url, {
            method,
            body,
            timeoutMs: effectiveTimeoutMs,
        });

        if (!response.ok) {
            const errorPayload = await parseJsonResponse(response).catch(() => ({}));
            throw Object.assign(new Error(
                safeString(errorPayload?.error || `Ollama request failed with ${response.status}`)
            ), {
                statusCode: response.status,
            });
        }

        return parseJsonResponse(response);
    });
};

const checkOllamaHealth = async ({ force = false } = {}) => {
    const config = getGatewayConfig();
    if (!force && healthState.checkedAt && (Date.now() - healthState.checkedAt) < HEALTH_CACHE_MS) {
        return {
            ...healthState,
            baseUrl: config.baseUrl,
            chatModel: config.chatModel,
            chatModelFallbacks: config.chatModelFallbacks,
            embedModel: config.embedModel,
            keepAlive: config.keepAlive,
        };
    }

    try {
        const payload = await executeOllamaRequest('/api/tags', {
            method: 'GET',
            body: undefined,
            timeoutMs: Math.min(config.timeoutMs, 8_000),
        });
        const availableModels = Array.isArray(payload?.models)
            ? payload.models.map((entry) => safeString(entry?.name || entry?.model || '')).filter(Boolean)
            : [];
        updateHealthState({
            healthy: true,
            error: '',
            availableModels,
            baseUrl: config.baseUrl,
            chatModel: config.chatModel,
            chatModelFallbacks: config.chatModelFallbacks,
            embedModel: config.embedModel,
            resolvedChatModel: safeString(healthState.resolvedChatModel || config.chatModel),
            keepAlive: config.keepAlive,
        });
    } catch (error) {
        updateHealthState({
            healthy: false,
            error: safeString(error?.message || 'ollama_unavailable'),
            availableModels: [],
            baseUrl: config.baseUrl,
            chatModel: config.chatModel,
            chatModelFallbacks: config.chatModelFallbacks,
            embedModel: config.embedModel,
            resolvedChatModel: '',
            keepAlive: config.keepAlive,
        });
    }

    return { ...healthState };
};

const parseStructuredResponse = (payload = {}) => {
    const raw = safeString(payload?.response || payload?.message?.content || '');
    if (!raw) {
        throw new Error('ollama_empty_response');
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        logger.warn('assistant.ollama.invalid_json_payload', {
            error: error.message,
            preview: raw.slice(0, 400),
        });
        throw Object.assign(new Error('ollama_invalid_structured_payload'), {
            rawPayload: raw,
        });
    }
};

const buildChatModelCandidates = ({ chatModel = '', chatModelFallbacks = [] } = {}, availableModels = []) => {
    const resolvedChatModel = safeString(healthState.resolvedChatModel);
    const configuredCandidates = uniq([
        resolvedChatModel,
        chatModel,
        ...(Array.isArray(chatModelFallbacks) ? chatModelFallbacks : []),
    ]);
    if (!configuredCandidates.length) return [];

    const available = uniq(availableModels);
    if (!available.length) return configuredCandidates;

    const availableSet = new Set(available);
    const installedCandidates = configuredCandidates.filter((model) => availableSet.has(model));
    return installedCandidates.length ? installedCandidates : configuredCandidates;
};

const isRetryableChatModelError = (error) => {
    const message = safeString(error?.message || '').toLowerCase();
    if (!message) return false;

    if (error?.statusCode === 404) return true;
    return (
        message.includes('model requires more system memory')
        || message.includes('insufficient memory')
        || message.includes('not enough memory')
        || message.includes('model failed to load')
        || message.includes('socket hang up')
        || message.includes('econnreset')
        || message.includes('connection reset')
        || message.includes('resource limitations')
        || message.includes('not found')
        || message.includes('no such file')
        || message.includes('ollama_invalid_structured_payload')
        || message.includes('ollama_empty_response')
    );
};

const generateStructuredJson = async ({
    systemPrompt = '',
    prompt = '',
    route = 'GENERAL',
    temperature = 0.2,
} = {}) => {
    const config = getGatewayConfig();
    const health = await checkOllamaHealth();
    if (!health.healthy) {
        throw new Error(health.error || 'ollama_unavailable');
    }

    const candidates = buildChatModelCandidates(config, health.availableModels);
    let lastError = null;

    for (let index = 0; index < candidates.length; index += 1) {
        const model = candidates[index];
        try {
            const payload = await executeOllamaRequest('/api/generate', {
                body: {
                    model,
                    system: systemPrompt,
                    prompt,
                    stream: false,
                    format: 'json',
                    keep_alive: config.keepAlive,
                    options: {
                        temperature,
                    },
                },
                timeoutMs: config.timeoutMs,
            });
            const data = parseStructuredResponse(payload);
            updateHealthState({
                healthy: true,
                error: '',
                availableModels: Array.isArray(health.availableModels) ? health.availableModels : [],
                baseUrl: config.baseUrl,
                chatModel: config.chatModel,
                chatModelFallbacks: config.chatModelFallbacks,
                embedModel: config.embedModel,
                resolvedChatModel: model,
                keepAlive: config.keepAlive,
            });
            return {
                data,
                provider: 'ollama',
                providerModel: model,
                route,
            };
        } catch (error) {
            lastError = error;
            const hasNextCandidate = index < (candidates.length - 1);
            if (!hasNextCandidate || !isRetryableChatModelError(error)) {
                throw error;
            }
            logger.warn('assistant.ollama.chat_model_retry', {
                failedModel: model,
                nextModel: candidates[index + 1],
                error: safeString(error?.message || 'ollama_chat_model_retry'),
                route,
            });
        }
    }

    throw lastError || new Error('ollama_no_chat_model_available');
};

const warmChatModel = async ({
    reason = 'startup',
    timeoutMs,
} = {}) => {
    const config = getGatewayConfig();
    const health = await checkOllamaHealth({ force: true });
    if (!health.healthy) {
        throw new Error(health.error || 'ollama_unavailable');
    }

    const candidates = buildChatModelCandidates(config, health.availableModels);
    if (!candidates.length) {
        throw new Error('ollama_no_chat_model_available');
    }

    const warmTimeoutMs = toPositiveNumber(timeoutMs, Math.max(config.timeoutMs, 120_000));
    let lastError = null;

    for (let index = 0; index < candidates.length; index += 1) {
        const model = candidates[index];

        try {
            const response = await performOllamaHttpRequest(`${config.baseUrl}/api/generate`, {
                body: {
                    model,
                    prompt: 'Return JSON only: {"ready":true}',
                    stream: false,
                    format: 'json',
                    // Warm-up should discover a viable model without pinning it in memory.
                    keep_alive: '0s',
                    options: {
                        temperature: 0,
                        num_predict: 32,
                    },
                },
                timeoutMs: warmTimeoutMs,
            });

            if (!response.ok) {
                const errorPayload = await parseJsonResponse(response).catch(() => ({}));
                throw Object.assign(new Error(
                    safeString(errorPayload?.error || `Ollama warmup failed with ${response.status}`)
                ), {
                    statusCode: response.status,
                });
            }

            parseStructuredResponse(await parseJsonResponse(response));
            updateHealthState({
                healthy: true,
                error: '',
                availableModels: Array.isArray(health.availableModels) ? health.availableModels : [],
                baseUrl: config.baseUrl,
                chatModel: config.chatModel,
                chatModelFallbacks: config.chatModelFallbacks,
                embedModel: config.embedModel,
                resolvedChatModel: model,
                keepAlive: config.keepAlive,
            });
            logger.info('assistant.ollama.warmup_ready', {
                model,
                reason,
                timeoutMs: warmTimeoutMs,
            });
            return {
                warmed: true,
                provider: 'ollama',
                providerModel: model,
                timeoutMs: warmTimeoutMs,
            };
        } catch (error) {
            lastError = error;
            const hasNextCandidate = index < (candidates.length - 1);
            if (!hasNextCandidate || !isRetryableChatModelError(error)) {
                logger.warn('assistant.ollama.warmup_failed', {
                    model,
                    reason,
                    timeoutMs: warmTimeoutMs,
                    error: safeString(error?.message || 'ollama_warmup_failed'),
                });
                throw error;
            }

            logger.warn('assistant.ollama.warmup_retry', {
                failedModel: model,
                nextModel: candidates[index + 1],
                reason,
                timeoutMs: warmTimeoutMs,
                error: safeString(error?.message || 'ollama_warmup_retry'),
            });
        }
    }

    throw lastError || new Error('ollama_warmup_failed');
};

const embedText = async (text = '') => {
    const input = safeString(text);
    if (!input) return [];

    const config = getGatewayConfig();
    const health = await checkOllamaHealth();
    if (!health.healthy) {
        throw new Error(health.error || 'ollama_unavailable');
    }

    try {
        const payload = await executeOllamaRequest('/api/embed', {
            body: {
                model: config.embedModel,
                input,
            },
            timeoutMs: config.timeoutMs,
        });
        return Array.isArray(payload?.embeddings?.[0]) ? payload.embeddings[0] : [];
    } catch {
        const fallback = await executeOllamaRequest('/api/embeddings', {
            body: {
                model: config.embedModel,
                prompt: input,
            },
            timeoutMs: config.timeoutMs,
        });
        return Array.isArray(fallback?.embedding) ? fallback.embedding : [];
    }
};

const getOllamaHealth = () => ({
    ...healthState,
    ...getGatewayConfig(),
    breaker: breaker.stats(),
});

module.exports = {
    checkOllamaHealth,
    embedText,
    generateStructuredJson,
    getGatewayConfig,
    getOllamaHealth,
    warmChatModel,
};
