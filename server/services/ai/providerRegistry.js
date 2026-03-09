const crypto = require('crypto');

const AI_DEFAULT_LOCALE = process.env.AI_DEFAULT_LOCALE || 'en-IN';

const GROQ_API_BASE_URL = process.env.GROQ_API_BASE_URL || 'https://api.groq.com/openai/v1';
const GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b';
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_AUDIO_MODEL = process.env.GROQ_AUDIO_MODEL || 'whisper-large-v3-turbo';
const GROQ_MODERATION_MODEL = process.env.GROQ_MODERATION_MODEL || 'openai/gpt-oss-safeguard-20b';
const GROQ_REQUEST_TIMEOUT_MS = Number(process.env.GROQ_REQUEST_TIMEOUT_MS || 12000);
const GROQ_RETRY_DELAY_MS = Number(process.env.GROQ_RETRY_DELAY_MS || 1000);
const GROQ_MAX_RETRIES = Number(process.env.GROQ_MAX_RETRIES || 1);

const VOYAGE_API_BASE_URL = process.env.VOYAGE_API_BASE_URL || 'https://api.voyageai.com/v1';
const VOYAGE_TEXT_EMBEDDING_MODEL = process.env.VOYAGE_TEXT_EMBEDDING_MODEL || 'voyage-3.5-lite';
const VOYAGE_RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL || 'rerank-2.5-lite';
const VOYAGE_REQUEST_TIMEOUT_MS = Number(process.env.VOYAGE_REQUEST_TIMEOUT_MS || 12000);
const VOYAGE_RETRY_DELAY_MS = Number(process.env.VOYAGE_RETRY_DELAY_MS || 900);
const VOYAGE_MAX_RETRIES = Number(process.env.VOYAGE_MAX_RETRIES || 1);

const ELEVENLABS_API_BASE_URL = process.env.ELEVENLABS_API_BASE_URL || 'https://api.elevenlabs.io/v1';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
const ELEVENLABS_REQUEST_TIMEOUT_MS = Number(process.env.ELEVENLABS_REQUEST_TIMEOUT_MS || 15000);
const ELEVENLABS_RETRY_DELAY_MS = Number(process.env.ELEVENLABS_RETRY_DELAY_MS || 1000);
const ELEVENLABS_MAX_RETRIES = Number(process.env.ELEVENLABS_MAX_RETRIES || 1);

const LIVEKIT_URL = process.env.LIVEKIT_URL || process.env.LIVEKIT_WS_URL || process.env.LIVEKIT_SERVER_URL || '';
const LIVEKIT_TTL_SECONDS = Number(process.env.LIVEKIT_TTL_SECONDS || 600);
const LIVEKIT_ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'aura-voice';

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getGroqApiKey = () => safeString(process.env.GROQ_API_KEY || '');
const getVoyageApiKey = () => safeString(process.env.VOYAGE_API_KEY || '');
const getElevenLabsApiKey = () => safeString(process.env.ELEVENLABS_API_KEY || '');
const getLiveKitApiKey = () => safeString(process.env.LIVEKIT_API_KEY || '');
const getLiveKitApiSecret = () => safeString(process.env.LIVEKIT_API_SECRET || '');

let cachedElevenVoiceId = safeString(process.env.ELEVENLABS_VOICE_ID || '');

const parseJsonObject = (rawText = '') => {
    const trimmed = safeString(rawText);
    if (!trimmed) return null;

    try {
        return JSON.parse(trimmed);
    } catch (_) {
        const objectMatch = trimmed.match(/\{[\s\S]*\}/);
        if (!objectMatch) return null;

        try {
            return JSON.parse(objectMatch[0]);
        } catch {
            return null;
        }
    }
};

const parseResponsePayload = async (response) => {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const normalizeErrorPayload = (payload) => {
    if (typeof payload === 'string') return safeString(payload);
    return safeString(payload?.error?.message || payload?.error || payload?.message || JSON.stringify(payload || {}));
};

const performRequest = async ({
    provider,
    url,
    method = 'POST',
    headers = {},
    body,
    timeoutMs = 10000,
    retries = 0,
    retryDelayMs = 800,
}) => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        let response;
        try {
            response = await fetch(url, {
                method,
                headers,
                body,
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                await delay(retryDelayMs * (attempt + 1));
                continue;
            }
            throw new Error(`${provider} request failed: ${safeString(error?.message || error)}`);
        }

        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
            await response.arrayBuffer().catch(() => null);
            await delay(retryDelayMs * (attempt + 1));
            continue;
        }

        if (!response.ok) {
            const errorPayload = await parseResponsePayload(response);
            throw new Error(`${provider} request failed with status ${response.status}: ${normalizeErrorPayload(errorPayload)}`);
        }

        return response;
    }

    throw lastError || new Error(`${provider} request failed`);
};

const buildGroqImageBlocks = (images = []) => (
    (Array.isArray(images) ? images : [])
        .slice(0, 3)
        .map((image) => {
            const dataUrl = safeString(image?.dataUrl || '');
            const url = dataUrl || safeString(image?.url || '');
            if (!url) return null;
            return {
                type: 'image_url',
                image_url: {
                    url,
                },
            };
        })
        .filter(Boolean)
);

const normalizeGroqUserContent = ({ text = '', images = [] }) => {
    const messageText = safeString(text) || 'Analyze the provided input.';
    const imageBlocks = buildGroqImageBlocks(images);
    if (imageBlocks.length === 0) return messageText;
    return [
        { type: 'text', text: messageText },
        ...imageBlocks,
    ];
};

const extractGroqOutputText = (payload = {}) => {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return safeString(content);
    if (Array.isArray(content)) {
        return content
            .map((entry) => {
                if (typeof entry === 'string') return safeString(entry);
                if (typeof entry?.text === 'string') return safeString(entry.text);
                if (typeof entry?.content === 'string') return safeString(entry.content);
                return '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    return safeString(payload?.output_text || '');
};

const callGroqChatCompletion = async ({
    systemPrompt,
    userPrompt,
    images = [],
    temperature = 0.2,
    maxTokens = 900,
    preferVision = false,
}) => {
    const apiKey = getGroqApiKey();
    if (!apiKey) return null;

    const response = await performRequest({
        provider: 'Groq',
        url: `${GROQ_API_BASE_URL}/chat/completions`,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: preferVision ? GROQ_VISION_MODEL : GROQ_CHAT_MODEL,
            messages: [
                {
                    role: 'system',
                    content: safeString(systemPrompt),
                },
                {
                    role: 'user',
                    content: normalizeGroqUserContent({
                        text: userPrompt,
                        images,
                    }),
                },
            ],
            temperature,
            max_completion_tokens: maxTokens,
            include_reasoning: false,
            reasoning_effort: 'low',
        }),
        timeoutMs: GROQ_REQUEST_TIMEOUT_MS,
        retries: GROQ_MAX_RETRIES,
        retryDelayMs: GROQ_RETRY_DELAY_MS,
    });

    const payload = await response.json();
    return {
        payload,
        provider: 'groq',
        model: preferVision ? GROQ_VISION_MODEL : GROQ_CHAT_MODEL,
    };
};

const buildHeuristicVisualDescription = ({
    message = '',
    hints = '',
    fileName = '',
    imageMeta = {},
}) => {
    const combined = [
        safeString(message),
        safeString(hints),
        safeString(fileName).replace(/\.[a-z0-9]+$/i, ''),
        safeString(imageMeta?.mimeType),
        safeString(imageMeta?.source),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/https?:\/\/[^ ]+/g, ' ')
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const tokens = combined
        .split(' ')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 3)
        .filter((entry) => ![
            'image', 'photo', 'camera', 'screenshot', 'upload', 'file', 'jpeg', 'jpg', 'png', 'webp', 'audio',
        ].includes(entry));

    const uniqueTokens = [...new Set(tokens)].slice(0, 8);
    const searchQuery = uniqueTokens.slice(0, 5).join(' ');

    return {
        caption: searchQuery ? `Likely product match for ${searchQuery}` : 'Product image',
        searchQuery,
        keywords: uniqueTokens,
        categoryHints: uniqueTokens.slice(0, 3),
        attributes: uniqueTokens.slice(0, 5),
        confidence: searchQuery ? 0.38 : 0.18,
        provider: 'heuristic',
    };
};

const generateStructuredResponse = async ({
    systemPrompt,
    userPrompt,
    images = [],
    temperature = 0.2,
    maxTokens = 900,
    preferVision = false,
}) => {
    try {
        const response = await callGroqChatCompletion({
            systemPrompt,
            userPrompt,
            images,
            temperature,
            maxTokens,
            preferVision,
        });

        if (!response) {
            return {
                payload: null,
                provider: 'local',
                model: 'local',
                rawText: '',
                errors: [],
            };
        }

        const rawText = extractGroqOutputText(response.payload);
        const payload = parseJsonObject(rawText);
        if (!payload) {
            throw new Error('Groq returned non-JSON assistant payload');
        }

        return {
            payload,
            provider: response.provider,
            model: response.model,
            rawText,
            errors: [],
        };
    } catch (error) {
        return {
            payload: null,
            provider: 'local',
            model: 'local',
            rawText: '',
            errors: [error],
        };
    }
};

const describeVisualInput = async ({
    message = '',
    hints = '',
    fileName = '',
    imageMeta = {},
    images = [],
}) => {
    const systemPrompt = [
        'You are a multimodal commerce indexing model for an ecommerce catalog.',
        'Return strict JSON only.',
        'Do not mention any information not directly visible or strongly inferable from the image metadata and hints.',
        'Schema:',
        '{"caption":"string","searchQuery":"string","keywords":["string"],"categoryHints":["string"],"attributes":["string"],"confidence":0.0}',
    ].join('\n');

    const userPrompt = [
        `User message: ${safeString(message) || 'None'}`,
        `Hints: ${safeString(hints) || 'None'}`,
        `File name: ${safeString(fileName) || 'None'}`,
        `Image metadata: ${JSON.stringify(imageMeta || {})}`,
        'Return a compact ecommerce-friendly caption, a search query, and short keywords.',
    ].join('\n');

    const heuristic = buildHeuristicVisualDescription({
        message,
        hints,
        fileName,
        imageMeta,
    });

    const response = await generateStructuredResponse({
        systemPrompt,
        userPrompt,
        images,
        temperature: 0.1,
        maxTokens: 400,
        preferVision: true,
    });

    const payload = response.payload || {};
    return {
        caption: safeString(payload.caption || heuristic.caption),
        searchQuery: safeString(payload.searchQuery || heuristic.searchQuery),
        keywords: Array.isArray(payload.keywords)
            ? payload.keywords.map((entry) => safeString(entry)).filter(Boolean).slice(0, 10)
            : heuristic.keywords,
        categoryHints: Array.isArray(payload.categoryHints)
            ? payload.categoryHints.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4)
            : heuristic.categoryHints,
        attributes: Array.isArray(payload.attributes)
            ? payload.attributes.map((entry) => safeString(entry)).filter(Boolean).slice(0, 8)
            : heuristic.attributes,
        confidence: clamp(payload.confidence || heuristic.confidence, 0, 1),
        provider: response.provider === 'local' ? heuristic.provider : response.provider,
    };
};

const extractEmbeddingVector = (entry = {}) => {
    if (Array.isArray(entry?.embedding)) return entry.embedding;
    if (Array.isArray(entry?.embeddings)) return entry.embeddings;
    return [];
};

const embedTexts = async (inputs = []) => {
    const apiKey = getVoyageApiKey();
    const normalized = (Array.isArray(inputs) ? inputs : [])
        .map((entry) => {
            if (typeof entry === 'string') {
                return safeString(entry);
            }

            return safeString(entry?.text || '');
        })
        .filter(Boolean)
        .slice(0, 32);

    if (normalized.length === 0 || !apiKey) return [];

    try {
        const response = await performRequest({
            provider: 'Voyage',
            url: `${VOYAGE_API_BASE_URL}/embeddings`,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: VOYAGE_TEXT_EMBEDDING_MODEL,
                input: normalized,
                truncation: true,
            }),
            timeoutMs: VOYAGE_REQUEST_TIMEOUT_MS,
            retries: VOYAGE_MAX_RETRIES,
            retryDelayMs: VOYAGE_RETRY_DELAY_MS,
        });

        const payload = await response.json();
        const data = Array.isArray(payload?.data) ? payload.data : [];
        return normalized.map((_, index) => extractEmbeddingVector(data[index]));
    } catch {
        return normalized.map(() => []);
    }
};

const cosineSimilarity = (left = [], right = []) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0 || left.length !== right.length) {
        return 0;
    }

    let numerator = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;

    for (let index = 0; index < left.length; index += 1) {
        const leftValue = Number(left[index]) || 0;
        const rightValue = Number(right[index]) || 0;
        numerator += leftValue * rightValue;
        leftMagnitude += leftValue * leftValue;
        rightMagnitude += rightValue * rightValue;
    }

    if (leftMagnitude <= 0 || rightMagnitude <= 0) return 0;
    return numerator / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};

const tokenize = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2);

const localRerank = ({ query = '', documents = [], topN = 12 }) => {
    const queryTokens = tokenize(query);
    const weightedDocuments = (Array.isArray(documents) ? documents : []).map((document, index) => {
        const text = safeString(document?.text || document?.title || '');
        const documentTokens = tokenize(text);
        const overlap = queryTokens.reduce((total, token) => total + (documentTokens.includes(token) ? 1 : 0), 0);
        const lexicalScore = queryTokens.length > 0 ? overlap / queryTokens.length : 0;
        const semanticScore = Number(document?.semanticScore || 0);
        return {
            index,
            document,
            score: Number(((lexicalScore * 0.55) + (semanticScore * 0.45)).toFixed(4)),
        };
    });

    return weightedDocuments
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(1, topN))
        .map((entry) => ({
            index: entry.index,
            score: entry.score,
            document: entry.document,
        }));
};

const rerankDocuments = async ({ query = '', documents = [], topN = 12 }) => {
    const apiKey = getVoyageApiKey();
    const normalizedDocuments = Array.isArray(documents) ? documents : [];

    if (!apiKey || !safeString(query) || normalizedDocuments.length === 0) {
        return localRerank({ query, documents: normalizedDocuments, topN });
    }

    try {
        const response = await performRequest({
            provider: 'Voyage',
            url: `${VOYAGE_API_BASE_URL}/rerank`,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: VOYAGE_RERANK_MODEL,
                query: safeString(query),
                documents: normalizedDocuments.map((document) => safeString(document?.text || document?.title || '')),
                top_k: Math.max(1, topN),
            }),
            timeoutMs: VOYAGE_REQUEST_TIMEOUT_MS,
            retries: VOYAGE_MAX_RETRIES,
            retryDelayMs: VOYAGE_RETRY_DELAY_MS,
        });

        const payload = await response.json();
        const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.results) ? payload.results : [];
        if (data.length === 0) {
            return localRerank({ query, documents: normalizedDocuments, topN });
        }

        return data
            .map((entry) => {
                const index = Number(entry?.index);
                if (!Number.isInteger(index) || !normalizedDocuments[index]) return null;
                return {
                    index,
                    score: Number(entry?.relevance_score || entry?.score || 0),
                    document: normalizedDocuments[index],
                };
            })
            .filter(Boolean)
            .slice(0, Math.max(1, topN));
    } catch {
        return localRerank({ query, documents: normalizedDocuments, topN });
    }
};

const base64UrlEncode = (input) => Buffer.from(input).toString('base64url');

const createLiveKitToken = ({ identity, roomName, locale }) => {
    const apiKey = getLiveKitApiKey();
    const apiSecret = getLiveKitApiSecret();
    const serverUrl = safeString(LIVEKIT_URL);

    if (!apiKey || !apiSecret || !serverUrl) {
        return {
            enabled: false,
            serverUrl,
            reason: !serverUrl && (apiKey || apiSecret) ? 'missing_livekit_url' : 'missing_livekit_credentials',
        };
    }

    const now = Math.floor(Date.now() / 1000);
    const room = safeString(roomName || LIVEKIT_ROOM_NAME);
    const subject = safeString(identity || `aura-${Math.random().toString(36).slice(2, 10)}`);
    const payload = {
        iss: apiKey,
        sub: subject,
        iat: now,
        nbf: now - 10,
        exp: now + LIVEKIT_TTL_SECONDS,
        jti: crypto.randomUUID(),
        video: {
            roomJoin: true,
            room,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
        },
        metadata: JSON.stringify({
            locale: safeString(locale || AI_DEFAULT_LOCALE),
            source: 'aura-ai',
        }),
    };

    const header = {
        alg: 'HS256',
        typ: 'JWT',
    };

    const headerSegment = base64UrlEncode(JSON.stringify(header));
    const payloadSegment = base64UrlEncode(JSON.stringify(payload));
    const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(`${headerSegment}.${payloadSegment}`)
        .digest('base64url');

    return {
        enabled: true,
        serverUrl,
        roomName: room,
        identity: subject,
        token: `${headerSegment}.${payloadSegment}.${signature}`,
        expiresAt: new Date((now + LIVEKIT_TTL_SECONDS) * 1000).toISOString(),
    };
};

const resolveElevenLabsVoiceId = async () => {
    if (cachedElevenVoiceId) return cachedElevenVoiceId;

    const apiKey = getElevenLabsApiKey();
    if (!apiKey) return '';

    try {
        const response = await performRequest({
            provider: 'ElevenLabs',
            url: `${ELEVENLABS_API_BASE_URL}/voices`,
            method: 'GET',
            headers: {
                'xi-api-key': apiKey,
                Accept: 'application/json',
            },
            timeoutMs: ELEVENLABS_REQUEST_TIMEOUT_MS,
            retries: ELEVENLABS_MAX_RETRIES,
            retryDelayMs: ELEVENLABS_RETRY_DELAY_MS,
        });

        const payload = await response.json();
        cachedElevenVoiceId = safeString(payload?.voices?.[0]?.voice_id || '');
        return cachedElevenVoiceId;
    } catch {
        return '';
    }
};

const synthesizeSpeech = async ({
    text = '',
    locale = AI_DEFAULT_LOCALE,
}) => {
    const apiKey = getElevenLabsApiKey();
    const normalizedText = safeString(text).slice(0, 600);
    if (!apiKey || !normalizedText) return null;

    const voiceId = await resolveElevenLabsVoiceId();
    if (!voiceId) return null;

    const response = await performRequest({
        provider: 'ElevenLabs',
        url: `${ELEVENLABS_API_BASE_URL}/text-to-speech/${voiceId}`,
        headers: {
            'xi-api-key': apiKey,
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text: normalizedText,
            model_id: ELEVENLABS_MODEL,
            language_code: safeString(locale || AI_DEFAULT_LOCALE).slice(0, 5),
            voice_settings: {
                stability: 0.45,
                similarity_boost: 0.78,
            },
        }),
        timeoutMs: ELEVENLABS_REQUEST_TIMEOUT_MS,
        retries: ELEVENLABS_MAX_RETRIES,
        retryDelayMs: ELEVENLABS_RETRY_DELAY_MS,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
        provider: 'elevenlabs',
        model: ELEVENLABS_MODEL,
        voiceId,
        mimeType: safeString(response.headers.get('content-type') || 'audio/mpeg'),
        audioBase64: buffer.toString('base64'),
    };
};

const getCapabilitySnapshot = () => {
    const hasGroq = Boolean(getGroqApiKey());
    const hasVoyage = Boolean(getVoyageApiKey());
    const hasElevenLabs = Boolean(getElevenLabsApiKey());
    const hasLiveKitCredentials = Boolean(getLiveKitApiKey() && getLiveKitApiSecret());
    const hasLiveKit = hasLiveKitCredentials && Boolean(safeString(LIVEKIT_URL));

    return {
        locale: AI_DEFAULT_LOCALE,
        reasoning: hasGroq ? 'groq' : 'local',
        embeddings: hasVoyage ? 'voyage' : 'local',
        rerank: hasVoyage ? 'voyage' : 'local',
        speechToText: hasGroq ? 'groq_ready' : 'browser_fallback',
        textToSpeech: hasElevenLabs ? 'elevenlabs_ready' : 'browser_fallback',
        realtime: hasLiveKit ? 'livekit_ready' : hasLiveKitCredentials ? 'livekit_missing_url' : 'turn_based',
        vision: hasGroq ? 'groq' : 'heuristic',
        moderation: hasGroq ? 'groq_ready' : 'local',
        models: {
            chat: GROQ_CHAT_MODEL,
            vision: GROQ_VISION_MODEL,
            embeddings: VOYAGE_TEXT_EMBEDDING_MODEL,
            rerank: VOYAGE_RERANK_MODEL,
            audio: GROQ_AUDIO_MODEL,
            tts: ELEVENLABS_MODEL,
            moderation: GROQ_MODERATION_MODEL,
        },
    };
};

const createVoiceSessionConfig = ({ userId = '', locale = AI_DEFAULT_LOCALE } = {}) => {
    const capabilities = getCapabilitySnapshot();
    const effectiveLocale = safeString(locale || capabilities.locale || AI_DEFAULT_LOCALE);
    const livekitSession = createLiveKitToken({
        identity: safeString(userId || `guest-${Math.random().toString(36).slice(2, 10)}`),
        roomName: LIVEKIT_ROOM_NAME,
        locale: effectiveLocale,
    });

    return {
        sessionId: `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        expiresAt: new Date(Date.now() + (10 * 60 * 1000)).toISOString(),
        locale: effectiveLocale,
        userId: safeString(userId || ''),
        realtimeEnabled: Boolean(livekitSession.enabled),
        supportsAudioUpload: Boolean(getGroqApiKey()),
        supportsServerInterpretation: true,
        turnEndpoint: '/api/ai/chat',
        synthesisEndpoint: '/api/ai/voice/speak',
        capabilities: {
            reasoning: {
                provider: capabilities.reasoning,
                model: GROQ_CHAT_MODEL,
            },
            speechToText: {
                provider: getGroqApiKey() ? 'groq' : 'browser_fallback',
                mode: getGroqApiKey() ? 'server_ready' : 'browser_fallback',
                languageHints: ['en-IN', 'hi-IN'],
                model: GROQ_AUDIO_MODEL,
            },
            textToSpeech: {
                provider: getElevenLabsApiKey() ? 'elevenlabs' : 'browser_fallback',
                mode: getElevenLabsApiKey() ? 'server_ready' : 'browser_fallback',
                voiceId: safeString(process.env.ELEVENLABS_VOICE_ID || cachedElevenVoiceId || 'auto'),
                model: ELEVENLABS_MODEL,
            },
            realtime: {
                provider: livekitSession.enabled ? 'livekit' : 'disabled',
                enabled: Boolean(livekitSession.enabled),
                serverUrl: safeString(livekitSession.serverUrl || ''),
                roomName: safeString(livekitSession.roomName || ''),
                participantIdentity: safeString(livekitSession.identity || ''),
                expiresAt: safeString(livekitSession.expiresAt || ''),
                reason: safeString(livekitSession.reason || ''),
            },
        },
        livekit: livekitSession.enabled
            ? {
                serverUrl: livekitSession.serverUrl,
                roomName: livekitSession.roomName,
                participantIdentity: livekitSession.identity,
                token: livekitSession.token,
                expiresAt: livekitSession.expiresAt,
            }
            : null,
    };
};

module.exports = {
    cosineSimilarity,
    createVoiceSessionConfig,
    describeVisualInput,
    embedTexts,
    generateStructuredResponse,
    getCapabilitySnapshot,
    rerankDocuments,
    synthesizeSpeech,
};
