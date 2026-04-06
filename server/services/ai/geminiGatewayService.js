const fetch = require('node-fetch');
const { getBreaker } = require('../../utils/circuitBreaker');
const logger = require('../../utils/logger');

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_CHAT_MODEL = 'models/gemma-4-31b-it';
const DEFAULT_CHAT_MODEL_FALLBACKS = ['models/gemma-4-26b-a4b-it'];
const DEFAULT_AUDIO_MODEL = '';
const DEFAULT_AUDIO_MODEL_FALLBACKS = [];
const AUTO_AUDIO_MODEL_CANDIDATES = [
    'models/gemma-4-e4b-it',
    'models/gemma-4-e2b-it',
    'models/gemma-3n-e4b-it',
    'models/gemma-3n-e2b-it',
];
const DEFAULT_EMBED_MODEL = 'models/gemini-embedding-001';
const DEFAULT_TIMEOUT_MS = 45_000;
const HEALTH_CACHE_MS = 20_000;
const MAX_INLINE_MEDIA_BYTES = 20 * 1024 * 1024;
const GEMINI_MODEL_CAPABILITIES = {
    'models/gemma-4-31b-it': { textInput: true, imageInput: true, audioInput: false },
    'models/gemma-4-26b-a4b-it': { textInput: true, imageInput: true, audioInput: false },
    'models/gemma-4-e4b-it': { textInput: true, imageInput: true, audioInput: true },
    'models/gemma-4-e2b-it': { textInput: true, imageInput: true, audioInput: true },
    'models/gemma-3n-e4b-it': { textInput: true, imageInput: true, audioInput: false },
    'models/gemma-3n-e2b-it': { textInput: true, imageInput: true, audioInput: false },
};

const breaker = getBreaker('gemini_gateway', {
    failureThreshold: 4,
    successThreshold: 2,
    cooldownMs: 20_000,
    callTimeoutMs: DEFAULT_TIMEOUT_MS + 2_000,
});

const healthState = {
    healthy: null,
    checkedAt: 0,
    error: '',
    availableModels: [],
    baseUrl: '',
    chatModel: '',
    chatModelFallbacks: [],
    audioModel: '',
    audioModelFallbacks: [],
    embedModel: '',
    resolvedChatModel: '',
    resolvedAudioModel: '',
    provider: 'gemini',
    apiConfigured: false,
    capabilities: { textInput: true, imageInput: true, audioInput: false },
};

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const toPositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const uniq = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((entry) => safeString(entry)).filter(Boolean))];
const normalizeModelName = (value, fallback = '') => {
    const normalized = safeString(value || fallback);
    if (!normalized) return '';
    return normalized.startsWith('models/') ? normalized : `models/${normalized}`;
};
const parseModelList = (value, fallback = []) => {
    const source = safeString(value);
    if (!source) return uniq(fallback.map((entry) => normalizeModelName(entry)));
    return uniq(source.split(',').map((entry) => normalizeModelName(entry)));
};
const resolveConfiguredAudioCandidates = (config = getGatewayConfig()) => uniq([
    normalizeModelName(config.audioModel),
    ...(Array.isArray(config.audioModelFallbacks) ? config.audioModelFallbacks : []).map((entry) => normalizeModelName(entry)),
]).filter(Boolean);
const resolveInstalledModel = ({
    model = '',
    fallbacks = [],
    availableModels = [],
} = {}) => {
    const configuredCandidates = uniq([model, ...(Array.isArray(fallbacks) ? fallbacks : [])]
        .map((entry) => normalizeModelName(entry)));
    if (!configuredCandidates.length) {
        return '';
    }

    const availableSet = new Set((Array.isArray(availableModels) ? availableModels : []).map((entry) => normalizeModelName(entry)));
    if (availableSet.size === 0) {
        return configuredCandidates[0] || '';
    }

    return configuredCandidates.find((entry) => availableSet.has(entry)) || '';
};
const resolveAvailableAudioModel = ({
    config = getGatewayConfig(),
    availableModels = [],
} = {}) => {
    const configuredCandidates = resolveConfiguredAudioCandidates(config);
    const availableSet = new Set((Array.isArray(availableModels) ? availableModels : []).map((entry) => normalizeModelName(entry)));

    if (availableSet.size === 0) {
        return {
            model: configuredCandidates[0] || '',
            fallbacks: configuredCandidates.slice(1),
        };
    }

    const availableConfiguredCandidates = configuredCandidates.filter((entry) => availableSet.has(entry));
    if (availableConfiguredCandidates.length > 0) {
        return {
            model: availableConfiguredCandidates[0],
            fallbacks: availableConfiguredCandidates.slice(1),
        };
    }

    const autoCandidates = uniq(AUTO_AUDIO_MODEL_CANDIDATES.map((entry) => normalizeModelName(entry)))
        .filter((entry) => availableSet.has(entry));

    return {
        model: autoCandidates[0] || '',
        fallbacks: autoCandidates.slice(1),
    };
};
const resolveGatewayCapabilities = ({
    chatModel = '',
    resolvedChatModel = '',
    resolvedAudioModel = '',
} = {}) => {
    const chatCapabilities = resolveModelCapabilities(resolvedChatModel || chatModel);
    const audioCapabilities = resolvedAudioModel
        ? resolveModelCapabilities(resolvedAudioModel)
        : { textInput: false, imageInput: false, audioInput: false };

    return {
        textInput: Boolean(chatCapabilities.textInput || audioCapabilities.textInput),
        imageInput: Boolean(chatCapabilities.imageInput || audioCapabilities.imageInput),
        audioInput: Boolean(audioCapabilities.audioInput),
    };
};

const resolveModelCapabilities = (modelName = '') => {
    const normalized = normalizeModelName(modelName);
    if (GEMINI_MODEL_CAPABILITIES[normalized]) {
        return { ...GEMINI_MODEL_CAPABILITIES[normalized] };
    }

    if (normalized.startsWith('models/gemma-4-')) {
        return { textInput: true, imageInput: true, audioInput: false };
    }

    if (normalized.startsWith('models/gemma-3n-')) {
        return { textInput: true, imageInput: true, audioInput: false };
    }

    if (normalized.startsWith('models/gemma-3-')) {
        return { textInput: true, imageInput: true, audioInput: false };
    }

    if (normalized.startsWith('models/gemini-')) {
        return { textInput: true, imageInput: true, audioInput: true };
    }

    return { textInput: true, imageInput: false, audioInput: false };
};

const getGatewayConfig = () => ({
    provider: 'gemini',
    baseUrl: safeString(process.env.GEMINI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: safeString(process.env.GEMINI_API_KEY || ''),
    chatModel: normalizeModelName(process.env.GEMINI_CHAT_MODEL, DEFAULT_CHAT_MODEL),
    chatModelFallbacks: parseModelList(process.env.GEMINI_CHAT_MODEL_FALLBACKS, DEFAULT_CHAT_MODEL_FALLBACKS),
    audioModel: normalizeModelName(process.env.GEMINI_AUDIO_MODEL, DEFAULT_AUDIO_MODEL),
    audioModelFallbacks: parseModelList(process.env.GEMINI_AUDIO_MODEL_FALLBACKS, DEFAULT_AUDIO_MODEL_FALLBACKS),
    embedModel: normalizeModelName(process.env.GEMINI_EMBED_MODEL, DEFAULT_EMBED_MODEL),
    timeoutMs: toPositiveNumber(process.env.GEMINI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
});

const resolveModelProfile = ({
    config = getGatewayConfig(),
    images = [],
    audio = [],
    availableModels = [],
} = {}) => {
    if (Array.isArray(audio) && audio.length > 0) {
        const availableAudioModel = resolveAvailableAudioModel({ config, availableModels });
        if (availableAudioModel.model) {
            return {
                type: 'audio',
                model: availableAudioModel.model,
                fallbacks: availableAudioModel.fallbacks,
            };
        }
    }

    return {
        type: (Array.isArray(images) && images.length > 0) ? 'vision' : 'chat',
        model: normalizeModelName(config.chatModel),
        fallbacks: uniq((Array.isArray(config.chatModelFallbacks) ? config.chatModelFallbacks : [])
            .map((entry) => normalizeModelName(entry))),
    };
};

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
        throw Object.assign(new Error('gemini_invalid_json_response'), {
            cause: error,
            rawResponse: text.slice(0, 500),
        });
    }
};

const executeGeminiRequest = async (path, {
    method = 'POST',
    body = undefined,
    timeoutMs,
} = {}) => {
    const config = getGatewayConfig();
    if (!config.apiKey) {
        throw new Error('gemini_api_key_missing');
    }

    const url = `${config.baseUrl}${path}`;
    const effectiveTimeoutMs = toPositiveNumber(timeoutMs, config.timeoutMs);

    return breaker.call(async () => {
        const response = await fetch(url, {
            method,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'x-goog-api-key': config.apiKey,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            timeout: effectiveTimeoutMs,
        });

        if (!response.ok) {
            const errorPayload = await parseJsonResponse(response).catch(() => ({}));
            const errorMessage = safeString(
                errorPayload?.error?.message
                || errorPayload?.error
                || `Gemini request failed with ${response.status}`
            );
            throw Object.assign(new Error(errorMessage), {
                statusCode: response.status,
            });
        }

        return parseJsonResponse(response);
    });
};

const checkGeminiHealth = async ({ force = false } = {}) => {
    const config = getGatewayConfig();
    if (!force && healthState.checkedAt && (Date.now() - healthState.checkedAt) < HEALTH_CACHE_MS) {
        return {
            ...healthState,
            baseUrl: config.baseUrl,
            chatModel: config.chatModel,
            chatModelFallbacks: config.chatModelFallbacks,
            audioModel: config.audioModel,
            audioModelFallbacks: config.audioModelFallbacks,
            embedModel: config.embedModel,
            resolvedAudioModel: healthState.resolvedAudioModel,
            provider: 'gemini',
            apiConfigured: Boolean(config.apiKey),
        };
    }

    if (!config.apiKey) {
        updateHealthState({
            healthy: false,
            error: 'gemini_api_key_missing',
            availableModels: [],
            baseUrl: config.baseUrl,
            chatModel: config.chatModel,
            chatModelFallbacks: config.chatModelFallbacks,
            audioModel: config.audioModel,
            audioModelFallbacks: config.audioModelFallbacks,
            embedModel: config.embedModel,
            resolvedChatModel: '',
            resolvedAudioModel: '',
            provider: 'gemini',
            apiConfigured: false,
            capabilities: resolveModelCapabilities(config.chatModel),
        });
        return { ...healthState };
    }

    try {
        const payload = await executeGeminiRequest('/models', {
            method: 'GET',
            body: undefined,
            timeoutMs: Math.min(config.timeoutMs, 12_000),
        });
        const availableModels = Array.isArray(payload?.models)
            ? payload.models.map((entry) => normalizeModelName(entry?.name || '')).filter(Boolean)
            : [];
        const resolvedChatModel = resolveInstalledModel({
            model: config.chatModel,
            fallbacks: config.chatModelFallbacks,
            availableModels,
        });
        const availableAudioModel = resolveAvailableAudioModel({ config, availableModels });
        updateHealthState({
            healthy: true,
            error: '',
            availableModels,
            baseUrl: config.baseUrl,
            chatModel: config.chatModel,
            chatModelFallbacks: config.chatModelFallbacks,
            audioModel: config.audioModel,
            audioModelFallbacks: config.audioModelFallbacks,
            embedModel: config.embedModel,
            resolvedChatModel: safeString(resolvedChatModel || config.chatModel),
            resolvedAudioModel: safeString(availableAudioModel.model || ''),
            provider: 'gemini',
            apiConfigured: true,
            capabilities: resolveGatewayCapabilities({
                chatModel: config.chatModel,
                resolvedChatModel: safeString(resolvedChatModel || config.chatModel),
                resolvedAudioModel: safeString(availableAudioModel.model || ''),
            }),
        });
    } catch (error) {
        updateHealthState({
            healthy: false,
            error: safeString(error?.message || 'gemini_unavailable'),
            availableModels: [],
            baseUrl: config.baseUrl,
            chatModel: config.chatModel,
            chatModelFallbacks: config.chatModelFallbacks,
            audioModel: config.audioModel,
            audioModelFallbacks: config.audioModelFallbacks,
            embedModel: config.embedModel,
            resolvedChatModel: '',
            resolvedAudioModel: '',
            provider: 'gemini',
            apiConfigured: true,
            capabilities: resolveGatewayCapabilities({
                chatModel: config.chatModel,
                resolvedChatModel: '',
                resolvedAudioModel: '',
            }),
        });
    }

    return { ...healthState };
};

const getHealthyGeminiState = async ({ force = false } = {}) => {
    let health = await checkGeminiHealth({ force });
    if (!health.healthy && health.apiConfigured !== false) {
        health = await checkGeminiHealth({ force: true });
    }
    return health;
};

const extractResponseText = (payload = {}) => {
    const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
        .map((part) => safeString(part?.text || ''))
        .filter(Boolean)
        .join('\n')
        .trim();
    if (text) return text;

    const blockReason = safeString(payload?.promptFeedback?.blockReason || '');
    if (blockReason) {
        throw new Error(`gemini_blocked:${blockReason}`);
    }

    throw new Error('gemini_empty_response');
};

const extractBalancedJsonSubstring = (value = '', startIndex = 0) => {
    const source = safeString(value);
    const opening = source[startIndex];
    const closing = opening === '{' ? '}' : opening === '[' ? ']' : '';
    if (!closing) return '';

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
        const char = source[index];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === opening) {
            depth += 1;
            continue;
        }

        if (char === closing) {
            depth -= 1;
            if (depth === 0) {
                return source.slice(startIndex, index + 1);
            }
        }
    }

    return '';
};

const extractJsonCandidate = (value = '') => {
    const source = safeString(value);
    if (!source) return '';

    const fencedMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
        const fenced = safeString(fencedMatch[1]);
        if (fenced) return fenced;
    }

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (char !== '{' && char !== '[') continue;
        const candidate = extractBalancedJsonSubstring(source, index);
        if (!candidate) continue;
        try {
            JSON.parse(candidate);
            return candidate;
        } catch (error) {
            // Keep scanning for the first valid JSON payload.
        }
    }

    return source;
};

const parseStructuredResponse = (payload = {}) => {
    const raw = extractResponseText(payload);
    const candidate = extractJsonCandidate(raw);
    try {
        return JSON.parse(candidate);
    } catch (error) {
        logger.warn('assistant.gemini.invalid_json_payload', {
            error: error.message,
            preview: raw.slice(0, 400),
        });
        throw Object.assign(new Error('gemini_invalid_structured_payload'), {
            rawPayload: raw,
        });
    }
};

const parseDataUrl = (dataUrl = '') => {
    const normalized = safeString(dataUrl);
    const match = normalized.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
    if (!match) {
        throw new Error('gemini_invalid_data_url');
    }

    const mimeType = safeString(match[1] || 'application/octet-stream');
    const data = safeString(match[2] || '');
    if (!data) {
        throw new Error('gemini_invalid_data_url');
    }

    return {
        mimeType,
        data,
        byteLength: Buffer.from(data, 'base64').byteLength,
    };
};

const fetchRemoteInlineData = async ({ url = '', mimeType = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
    const response = await fetch(safeString(url), {
        method: 'GET',
        timeout: timeoutMs,
    });
    if (!response.ok) {
        throw new Error(`gemini_media_fetch_failed:${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
        mimeType: safeString(mimeType || response.headers.get('content-type') || 'application/octet-stream'),
        data: buffer.toString('base64'),
        byteLength: buffer.byteLength,
    };
};

const toInlineDataPart = async (media = {}, timeoutMs) => {
    const providedMimeType = safeString(media?.mimeType || '');
    let payload;

    if (safeString(media?.dataUrl || '')) {
        payload = parseDataUrl(media.dataUrl);
    } else if (safeString(media?.url || '')) {
        payload = await fetchRemoteInlineData({
            url: media.url,
            mimeType: providedMimeType,
            timeoutMs,
        });
    } else {
        return null;
    }

    if (Number(payload?.byteLength || 0) > MAX_INLINE_MEDIA_BYTES) {
        throw new Error('gemini_inline_media_too_large');
    }

    return {
        inlineData: {
            mimeType: safeString(providedMimeType || payload.mimeType || 'application/octet-stream'),
            data: safeString(payload.data || ''),
        },
    };
};

const buildMediaParts = async (items = [], timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const parts = [];
    for (const item of Array.isArray(items) ? items : []) {
        const part = await toInlineDataPart(item, timeoutMs);
        if (part) {
            parts.push(part);
        }
    }
    return parts;
};

const buildChatModelCandidates = ({ model = '', fallbacks = [] } = {}, availableModels = []) => {
    const configuredCandidates = uniq([model, ...(Array.isArray(fallbacks) ? fallbacks : [])]
        .map((entry) => normalizeModelName(entry)));
    if (!configuredCandidates.length) return [];

    const available = uniq((Array.isArray(availableModels) ? availableModels : []).map((entry) => normalizeModelName(entry)));
    if (!available.length) return configuredCandidates;

    const availableSet = new Set(available);
    const installedCandidates = configuredCandidates.filter((model) => availableSet.has(model));
    return installedCandidates.length ? installedCandidates : configuredCandidates;
};

const supportsRequestedMedia = (modelName = '', { images = [], audio = [] } = {}) => {
    const capabilities = resolveModelCapabilities(modelName);
    if (Array.isArray(images) && images.length > 0 && capabilities.imageInput === false) {
        return false;
    }
    if (Array.isArray(audio) && audio.length > 0 && capabilities.audioInput === false) {
        return false;
    }
    return true;
};

const isRetryableGeminiError = (error) => {
    const message = safeString(error?.message || '').toLowerCase();
    if (!message) return false;
    if ([404, 429, 500, 502, 503, 504].includes(Number(error?.statusCode || 0))) return true;
    return (
        message.includes('resource exhausted')
        || message.includes('temporarily unavailable')
        || message.includes('deadline exceeded')
        || message.includes('internal error')
        || message.includes('service unavailable')
        || message.includes('socket hang up')
        || message.includes('connection reset')
        || message.includes('timeout')
        || message.includes('gemini_invalid_structured_payload')
        || message.includes('gemini_empty_response')
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
    const config = getGatewayConfig();
    const health = await getHealthyGeminiState();
    if (!health.healthy) {
        throw new Error(health.error || 'gemini_unavailable');
    }

    const parts = [
        { text: safeString(prompt || 'Analyze the provided input and return JSON only.') },
        ...(await buildMediaParts(images, config.timeoutMs)),
        ...(await buildMediaParts(audio, config.timeoutMs)),
    ];
    const requestedMedia = { images, audio };
    const modelProfile = resolveModelProfile({
        config,
        images,
        audio,
        availableModels: health.availableModels,
    });
    const availableAudioModel = resolveAvailableAudioModel({
        config,
        availableModels: health.availableModels,
    });
    const candidates = buildChatModelCandidates({
        model: modelProfile.model,
        fallbacks: modelProfile.fallbacks,
    }, health.availableModels)
        .filter((model) => supportsRequestedMedia(model, requestedMedia));
    if (!candidates.length) {
        throw Object.assign(new Error(Array.isArray(audio) && audio.length > 0
            ? 'gemini_audio_input_not_supported'
            : 'gemini_requested_modalities_not_supported'), {
            statusCode: 400,
            capabilities: resolveModelCapabilities(health.resolvedChatModel || modelProfile.model || config.chatModel),
        });
    }
    let lastError = null;

    for (let index = 0; index < candidates.length; index += 1) {
        const model = candidates[index];
        try {
            const payload = await executeGeminiRequest(`/${normalizeModelName(model)}:generateContent`, {
                body: {
                    systemInstruction: {
                        parts: [{ text: safeString(systemPrompt || 'Return JSON only.') }],
                    },
                    contents: [{
                        role: 'user',
                        parts,
                    }],
                    generationConfig: {
                        temperature,
                        responseMimeType: 'application/json',
                        ...(responseJsonSchema && typeof responseJsonSchema === 'object'
                            ? { responseJsonSchema }
                            : {}),
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
                audioModel: config.audioModel,
                audioModelFallbacks: config.audioModelFallbacks,
                embedModel: config.embedModel,
                resolvedChatModel: normalizeModelName(model),
                resolvedAudioModel: modelProfile.type === 'audio'
                    ? normalizeModelName(model)
                    : safeString(availableAudioModel.model || healthState.resolvedAudioModel || ''),
                provider: 'gemini',
                apiConfigured: true,
                capabilities: resolveGatewayCapabilities({
                    chatModel: config.chatModel,
                    resolvedChatModel: normalizeModelName(model),
                    resolvedAudioModel: modelProfile.type === 'audio'
                        ? normalizeModelName(model)
                        : safeString(availableAudioModel.model || healthState.resolvedAudioModel || ''),
                }),
            });
            return {
                data,
                provider: 'gemini',
                providerModel: normalizeModelName(model),
                route,
            };
        } catch (error) {
            lastError = error;
            const hasNextCandidate = index < (candidates.length - 1);
            if (!hasNextCandidate || !isRetryableGeminiError(error)) {
                throw error;
            }
            logger.warn('assistant.gemini.chat_model_retry', {
                failedModel: normalizeModelName(model),
                nextModel: normalizeModelName(candidates[index + 1]),
                error: safeString(error?.message || 'gemini_chat_model_retry'),
                route,
            });
        }
    }

    throw lastError || new Error('gemini_no_chat_model_available');
};

const embedText = async (text = '', { taskType = 'RETRIEVAL_DOCUMENT' } = {}) => {
    const input = safeString(text);
    if (!input) return [];

    const config = getGatewayConfig();
    const health = await getHealthyGeminiState();
    if (!health.healthy) {
        throw new Error(health.error || 'gemini_unavailable');
    }

    const payload = await executeGeminiRequest(`/${normalizeModelName(config.embedModel)}:embedContent`, {
        body: {
            content: {
                role: 'user',
                parts: [{ text: input }],
            },
            taskType: safeString(taskType || 'RETRIEVAL_DOCUMENT'),
        },
        timeoutMs: config.timeoutMs,
    });

    return Array.isArray(payload?.embedding?.values) ? payload.embedding.values : [];
};

const warmChatModel = async ({ reason = 'startup' } = {}) => {
    const config = getGatewayConfig();
    const health = await checkGeminiHealth({ force: true });
    if (!health.healthy) {
        throw new Error(health.error || 'gemini_unavailable');
    }

    const modelProfile = resolveModelProfile({ config, availableModels: health.availableModels });
    const availableAudioModel = resolveAvailableAudioModel({
        config,
        availableModels: health.availableModels,
    });
    const candidates = buildChatModelCandidates({
        model: modelProfile.model,
        fallbacks: modelProfile.fallbacks,
    }, health.availableModels);
    const model = normalizeModelName(candidates[0] || config.chatModel);
    updateHealthState({
        healthy: true,
        error: '',
        availableModels: Array.isArray(health.availableModels) ? health.availableModels : [],
        baseUrl: config.baseUrl,
        chatModel: config.chatModel,
        chatModelFallbacks: config.chatModelFallbacks,
        audioModel: config.audioModel,
        audioModelFallbacks: config.audioModelFallbacks,
        embedModel: config.embedModel,
        resolvedChatModel: model,
        resolvedAudioModel: modelProfile.type === 'audio'
            ? model
            : safeString(availableAudioModel.model || ''),
        provider: 'gemini',
        apiConfigured: true,
        capabilities: resolveGatewayCapabilities({
            chatModel: config.chatModel,
            resolvedChatModel: model,
            resolvedAudioModel: modelProfile.type === 'audio'
                ? model
                : safeString(availableAudioModel.model || ''),
        }),
    });
    logger.info('assistant.gemini.warmup_ready', { model, reason });
    return {
        warmed: true,
        provider: 'gemini',
        providerModel: model,
    };
};

const getGeminiHealth = () => ({
    ...healthState,
    ...(() => {
        const config = getGatewayConfig();
        return {
            provider: config.provider,
            baseUrl: config.baseUrl,
            chatModel: config.chatModel,
            chatModelFallbacks: config.chatModelFallbacks,
            audioModel: config.audioModel,
            audioModelFallbacks: config.audioModelFallbacks,
            embedModel: config.embedModel,
            resolvedAudioModel: safeString(healthState.resolvedAudioModel || ''),
            timeoutMs: config.timeoutMs,
        };
    })(),
    provider: 'gemini',
    apiConfigured: Boolean(getGatewayConfig().apiKey),
    capabilities: resolveGatewayCapabilities({
        chatModel: getGatewayConfig().chatModel,
        resolvedChatModel: healthState.resolvedChatModel,
        resolvedAudioModel: healthState.resolvedAudioModel,
    }),
    breaker: breaker.stats(),
});

module.exports = {
    checkGeminiHealth,
    embedText,
    generateStructuredJson,
    getGatewayConfig,
    getGeminiHealth,
    getHealthyGeminiState,
    warmChatModel,
    __testables: {
        extractJsonCandidate,
        resolveAvailableAudioModel,
        resolveGatewayCapabilities,
        resolveModelProfile,
        resolveModelCapabilities,
        supportsRequestedMedia,
    },
};
