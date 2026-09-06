const { guardedFetch } = require('../../security/remoteFetchGuardService');
const { getBreaker } = require('../../utils/circuitBreaker');
const logger = require('../../utils/logger');

// OpenCode Zen gateway (https://opencode.ai/docs/zen/). The free tier
// (e.g. muse-spark-1.3-contributor-free) works without an API key; when one
// is configured it is sent as a bearer token for paid models and quotas.
const DEFAULT_BASE_URL = 'https://opencode.ai/zen/v1';
const DEFAULT_CHAT_MODEL = 'muse-spark-1.3-contributor-free';
const DEFAULT_CHAT_MODEL_FALLBACKS = [];
const DEFAULT_TIMEOUT_MS = 45_000;
const HEALTH_CACHE_MS = 20_000;
// Free-tier usage is a tight token budget and muse defaults to effort "high"
// (~250 reasoning tokens even for "hi"); low keeps structured JSON turns cheap.
const DEFAULT_REASONING_EFFORT = 'low';

const breaker = getBreaker('zen_gateway', {
    failureThreshold: 4,
    successThreshold: 2,
    cooldownMs: 20_000,
    callTimeoutMs: Number(process.env.ZEN_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
});

const healthState = {
    healthy: null,
    checkedAt: 0,
    error: '',
    availableModels: [],
    baseUrl: '',
    chatModel: '',
    chatModelFallbacks: [],
    resolvedChatModel: '',
    apiConfigured: false,
    capabilities: { textInput: true, imageInput: false, audioInput: false },
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
    baseUrl: safeString(process.env.ZEN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: safeString(process.env.ZEN_API_KEY || process.env.OPENCODE_API_KEY || ''),
    chatModel: safeString(process.env.ZEN_CHAT_MODEL || DEFAULT_CHAT_MODEL),
    chatModelFallbacks: parseModelList(process.env.ZEN_CHAT_MODEL_FALLBACKS, DEFAULT_CHAT_MODEL_FALLBACKS),
    timeoutMs: toPositiveNumber(process.env.ZEN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    reasoningEffort: safeString(process.env.ZEN_REASONING_EFFORT || DEFAULT_REASONING_EFFORT),
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
        throw Object.assign(new Error('zen_invalid_json_response'), {
            cause: error,
            rawResponse: text.slice(0, 500),
        });
    }
};

const executeZenRequest = async (path, {
    method = 'POST',
    body = undefined,
    timeoutMs,
} = {}) => {
    const config = getGatewayConfig();
    const url = `${config.baseUrl}${path}`;
    const effectiveTimeoutMs = toPositiveNumber(timeoutMs, config.timeoutMs);
    let host = '';
    try {
        host = new URL(config.baseUrl).hostname;
    } catch {
        // Invalid URLs are rejected by the egress guard.
    }

    return breaker.call(async () => {
        const response = await guardedFetch(url, {
            allowedHosts: host ? [host] : [],
            validateDns: false,
            allowPrivateTarget: true,
            method,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            timeoutMs: effectiveTimeoutMs,
        });

        if (!response.ok) {
            const errorPayload = await parseJsonResponse(response).catch(() => ({}));
            const errorMessage = safeString(
                errorPayload?.error?.message
                || errorPayload?.error
                || `Zen request failed with ${response.status}`
            );
            logger.warn('assistant.zen.request_failed', {
                path,
                statusCode: response.status,
                errorMessage,
                bodyPreview: safeString(errorPayload && typeof errorPayload === 'object' ? JSON.stringify(errorPayload) : '').slice(0, 300),
            });
            throw Object.assign(new Error(errorMessage), {
                statusCode: response.status,
            });
        }

        return parseJsonResponse(response);
    });
};

const checkZenHealth = async ({ force = false } = {}) => {
    const config = getGatewayConfig();
    if (!force && healthState.checkedAt && (Date.now() - healthState.checkedAt) < HEALTH_CACHE_MS) {
        return {
            ...healthState,
            baseUrl: config.baseUrl,
            chatModel: config.chatModel,
            chatModelFallbacks: config.chatModelFallbacks,
        };
    }

    try {
        const payload = await executeZenRequest('/models', {
            method: 'GET',
            body: undefined,
            timeoutMs: Math.min(config.timeoutMs, 8_000),
        });
        const rawModels = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.models) ? payload.models : []);
        const availableModels = rawModels
            .map((entry) => safeString(entry?.id || entry?.name || entry?.model || ''))
            .filter(Boolean);
        updateHealthState({
            healthy: true,
            error: '',
            availableModels,
            apiConfigured: Boolean(config.apiKey),
            resolvedChatModel: safeString(healthState.resolvedChatModel || config.chatModel),
        });
    } catch (error) {
        updateHealthState({
            healthy: false,
            error: safeString(error?.message || 'zen_unavailable'),
            availableModels: [],
            resolvedChatModel: '',
        });
    }

    return {
        ...healthState,
        baseUrl: config.baseUrl,
        chatModel: config.chatModel,
        chatModelFallbacks: config.chatModelFallbacks,
    };
};

const extractJsonCandidate = (text) => {
    const raw = safeString(text);
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const source = fenced ? fenced[1] : raw;
    const start = source.indexOf('{');
    if (start === -1) return source.trim();
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
        const char = source[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    return source.slice(start).trim();
};

// Responses API payloads carry reasoning items (no text) plus a message item
// whose content parts hold type "output_text". Prefer those parts so chain of
// thought never leaks into the structured payload.
const extractResponseText = (payload = {}) => {
    if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
        return payload.output_text.trim();
    }
    const items = Array.isArray(payload?.output) ? payload.output : [];
    const collect = (filterByType) => {
        const chunks = [];
        for (const item of items) {
            for (const part of Array.isArray(item?.content) ? item.content : []) {
                if (filterByType && part?.type !== 'output_text') continue;
                if (typeof part?.text === 'string' && part.text.trim()) chunks.push(part.text);
            }
        }
        return chunks.join('\n').trim();
    };
    return collect(true) || collect(false);
};

const parseStructuredOutput = (payload = {}) => {
    const raw = extractResponseText(payload);
    if (!raw) {
        throw new Error('zen_empty_response');
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        try {
            return JSON.parse(extractJsonCandidate(raw));
        } catch (retryError) {
            logger.warn('assistant.zen.invalid_json_payload', {
                error: retryError.message,
                preview: raw.slice(0, 400),
            });
            throw Object.assign(new Error('zen_invalid_structured_payload'), {
                rawPayload: raw,
            });
        }
    }
};

const buildInstructions = (systemPrompt = '', responseJsonSchema = null) => {
    if (!responseJsonSchema || typeof responseJsonSchema !== 'object') {
        return systemPrompt;
    }
    return [
        systemPrompt,
        'Respond with a single JSON object that matches this schema and nothing else:',
        JSON.stringify(responseJsonSchema),
    ].filter(Boolean).join('\n');
};

const buildChatModelCandidates = (config = {}) => uniq([
    safeString(healthState.resolvedChatModel),
    config.chatModel,
    ...(Array.isArray(config.chatModelFallbacks) ? config.chatModelFallbacks : []),
]);

const isRetryableChatModelError = (error) => {
    const message = safeString(error?.message || '').toLowerCase();
    if ([400, 401, 403].includes(Number(error?.statusCode || 0))) return false;
    if (!message) return true;
    return !(
        message.includes('invalid_json_response')
        || message.includes('zen_invalid_json_response')
    );
};

const generateStructuredJson = async ({
    systemPrompt = '',
    prompt = '',
    route = 'GENERAL',
    temperature = 0.2,
    images = [],
    audio = [],
    responseJsonSchema = null,
} = {}) => {
    if ((Array.isArray(images) && images.length > 0) || (Array.isArray(audio) && audio.length > 0)) {
        // Never answer a multimodal turn from text alone without saying so:
        // fail loud so the commerce layer falls back instead of hallucinating.
        logger.warn('assistant.zen.media_unsupported', {
            route,
            images: Array.isArray(images) ? images.length : 0,
            audio: Array.isArray(audio) ? audio.length : 0,
        });
        throw new Error('zen_media_unsupported');
    }

    const config = getGatewayConfig();
    const candidates = buildChatModelCandidates(config);
    if (!candidates.length) {
        throw new Error('zen_no_chat_model_available');
    }

    let lastError = null;
    for (let index = 0; index < candidates.length; index += 1) {
        const model = candidates[index];
        try {
            const payload = await executeZenRequest('/responses', {
                body: {
                    model,
                    instructions: buildInstructions(systemPrompt, responseJsonSchema),
                    input: prompt,
                    stream: false,
                    temperature,
                    reasoning: { effort: config.reasoningEffort },
                },
                timeoutMs: config.timeoutMs,
            });
            const data = parseStructuredOutput(payload);
            updateHealthState({
                healthy: true,
                error: '',
                apiConfigured: Boolean(config.apiKey),
                resolvedChatModel: model,
            });
            return {
                data,
                provider: 'zen',
                providerModel: model,
                route,
            };
        } catch (error) {
            lastError = error;
            const hasNextCandidate = index < (candidates.length - 1);
            if (!hasNextCandidate || !isRetryableChatModelError(error)) {
                throw error;
            }
            logger.warn('assistant.zen.chat_model_retry', {
                failedModel: model,
                nextModel: candidates[index + 1],
                error: safeString(error?.message || 'zen_chat_model_retry'),
                route,
            });
        }
    }

    throw lastError || new Error('zen_no_chat_model_available');
};

const warmChatModel = async ({
    reason = 'startup',
    timeoutMs,
} = {}) => {
    const config = getGatewayConfig();
    const warmTimeoutMs = toPositiveNumber(timeoutMs, Math.max(config.timeoutMs, 120_000));
    const payload = await executeZenRequest('/responses', {
        body: {
            model: config.chatModel,
            instructions: 'Return JSON only.',
            input: 'Return JSON only: {"ready":true}',
            stream: false,
            reasoning: { effort: config.reasoningEffort },
        },
        timeoutMs: warmTimeoutMs,
    });
    parseStructuredOutput(payload);
    updateHealthState({
        healthy: true,
        error: '',
        apiConfigured: Boolean(config.apiKey),
        resolvedChatModel: config.chatModel,
    });
    logger.info('assistant.zen.warmup_ready', {
        model: config.chatModel,
        reason,
        timeoutMs: warmTimeoutMs,
    });
    return {
        warmed: true,
        provider: 'zen',
        providerModel: config.chatModel,
        timeoutMs: warmTimeoutMs,
    };
};

const embedText = async () => {
    // Zen serves chat models only; embedding turns fail loud so the vector
    // index falls back to lexical retrieval instead of hallucinating vectors.
    throw new Error('zen_embeddings_unsupported');
};

const getZenHealth = () => ({
    ...healthState,
    ...getGatewayConfig(),
    breaker: breaker.stats(),
});

module.exports = {
    checkZenHealth,
    embedText,
    generateStructuredJson,
    getGatewayConfig,
    getZenHealth,
    warmChatModel,
    __testables: {
        extractJsonCandidate,
        extractResponseText,
        parseStructuredOutput,
    },
};
