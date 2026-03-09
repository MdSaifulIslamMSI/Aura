const BYTEZ_API_BASE_URL = process.env.BYTEZ_API_BASE_URL || 'https://api.bytez.com/models/v2';
const BYTEZ_CHAT_MODEL = process.env.BYTEZ_CHAT_MODEL || 'google/gemma-3-4b-it';
const BYTEZ_VISION_MODEL = process.env.BYTEZ_VISION_MODEL || 'google/gemma-3-4b-it';
const BYTEZ_TEXT_EMBEDDING_MODEL = process.env.BYTEZ_TEXT_EMBEDDING_MODEL || 'nomic-ai/nomic-embed-text-v1.5';
const BYTEZ_AUDIO_MODEL = process.env.BYTEZ_AUDIO_MODEL || 'Qwen/Qwen2-Audio-7B-Instruct';
const BYTEZ_TTS_MODEL = process.env.BYTEZ_TTS_MODEL || 'suno/bark-small';
const AI_DEFAULT_LOCALE = process.env.AI_DEFAULT_LOCALE || 'en-IN';
const BYTEZ_REQUEST_TIMEOUT_MS = Number(process.env.BYTEZ_REQUEST_TIMEOUT_MS || 8000);
const BYTEZ_RETRY_DELAY_MS = Number(process.env.BYTEZ_RETRY_DELAY_MS || 900);
const BYTEZ_MAX_RETRIES = Number(process.env.BYTEZ_MAX_RETRIES || 1);

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
let bytezRequestQueue = Promise.resolve();

const getBytezApiKey = () => safeString(process.env.BYTEZ_API_KEY || process.env.BYTEZ_KEY || '');

const getAuthorizationCandidates = (apiKey = '') => {
    const key = safeString(apiKey);
    if (!key) return [];

    return [key, `Key ${key}`, `Bearer ${key}`];
};

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

const parseJsonSafely = async (response) => {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const buildImageContentBlocks = (images = []) => (
    (Array.isArray(images) ? images : [])
        .slice(0, 3)
        .map((image) => {
            const dataUrl = safeString(image?.dataUrl || '');
            if (dataUrl) {
                return {
                    type: 'image',
                    base64: dataUrl.replace(/^data:[^;]+;base64,/, ''),
                };
            }

            const url = safeString(image?.url || '');
            if (!url) return null;
            return {
                type: 'image',
                url,
            };
        })
        .filter(Boolean)
);

const normalizeChatContent = ({ text = '', images = [] }) => {
    const cleanedText = safeString(text);
    const imageBlocks = buildImageContentBlocks(images);
    if (imageBlocks.length === 0) {
        return cleanedText;
    }

    return [
        { type: 'text', text: cleanedText },
        ...imageBlocks,
    ];
};

const extractOutputText = (payload) => {
    const output = payload?.output;
    if (typeof output === 'string') {
        return safeString(output);
    }

    if (Array.isArray(output)) {
        return output.map((entry) => {
            if (typeof entry === 'string') return safeString(entry);
            if (typeof entry?.text === 'string') return safeString(entry.text);
            if (typeof entry?.content === 'string') return safeString(entry.content);
            return '';
        }).filter(Boolean).join('\n').trim();
    }

    if (typeof output?.content === 'string') {
        return safeString(output.content);
    }

    if (Array.isArray(output?.content)) {
        return output.content.map((entry) => {
            if (typeof entry === 'string') return safeString(entry);
            if (typeof entry?.text === 'string') return safeString(entry.text);
            return '';
        }).filter(Boolean).join('\n').trim();
    }

    if (typeof payload?.response === 'string') {
        return safeString(payload.response);
    }

    return '';
};

const extractEmbeddingVector = (payload) => {
    if (Array.isArray(payload?.output)) return payload.output;
    if (Array.isArray(payload?.embedding)) return payload.embedding;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runQueuedBytezRequest = async (operation) => {
    const previous = bytezRequestQueue;
    let releaseQueue;
    bytezRequestQueue = new Promise((resolve) => {
        releaseQueue = resolve;
    });

    await previous.catch(() => {});
    try {
        return await operation();
    } finally {
        releaseQueue();
    }
};

const fetchBytezModel = async ({ modelId, body }) => {
    const apiKey = getBytezApiKey();
    if (!apiKey) return null;

    const url = `${BYTEZ_API_BASE_URL}/${modelId}`;
    const authCandidates = getAuthorizationCandidates(apiKey);
    const errors = [];

    for (let index = 0; index < authCandidates.length; index += 1) {
        const authorization = authCandidates[index];
        try {
            return await runQueuedBytezRequest(async () => {
                for (let attempt = 0; attempt <= BYTEZ_MAX_RETRIES; attempt += 1) {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            Authorization: authorization,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(body),
                        signal: AbortSignal.timeout(BYTEZ_REQUEST_TIMEOUT_MS),
                    });

                    if (response.status === 401 || response.status === 403) {
                        const errorPayload = await parseJsonSafely(response);
                        throw new Error(`Bytez auth rejected request (${response.status}): ${safeString(errorPayload?.error || errorPayload?.message || '')}`);
                    }

                    if (response.status === 429 && attempt < BYTEZ_MAX_RETRIES) {
                        await delay(BYTEZ_RETRY_DELAY_MS * (attempt + 1));
                        continue;
                    }

                    if (!response.ok) {
                        const errorPayload = await parseJsonSafely(response);
                        throw new Error(`Bytez model ${modelId} failed with status ${response.status}: ${safeString(errorPayload?.error || errorPayload?.message || JSON.stringify(errorPayload))}`);
                    }

                    const payload = await response.json();
                    return {
                        payload,
                        provider: 'bytez',
                        model: modelId,
                    };
                }

                throw new Error(`Bytez model ${modelId} exhausted retry budget`);
            });
        } catch (error) {
            errors.push(error);
        }
    }

    if (errors.length > 0) {
        throw errors[errors.length - 1];
    }

    return null;
};

const generateStructuredResponse = async ({
    systemPrompt,
    userPrompt,
    images = [],
    temperature = 0.2,
    maxTokens = 900,
    preferVision = false,
}) => {
    const model = preferVision ? BYTEZ_VISION_MODEL : BYTEZ_CHAT_MODEL;

    try {
        const response = await fetchBytezModel({
            modelId: model,
            body: {
                messages: [
                    {
                        role: 'system',
                        content: safeString(systemPrompt),
                    },
                    {
                        role: 'user',
                        content: normalizeChatContent({
                            text: userPrompt,
                            images,
                        }),
                    },
                ],
                params: {
                    temperature,
                    max_new_tokens: maxTokens,
                },
            },
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

        const rawText = extractOutputText(response.payload);
        const payload = parseJsonObject(rawText);
        if (!payload) {
            throw new Error('Bytez returned non-JSON assistant payload');
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
        caption: safeString(payload.caption),
        searchQuery: safeString(payload.searchQuery),
        keywords: Array.isArray(payload.keywords)
            ? payload.keywords.map((entry) => safeString(entry)).filter(Boolean).slice(0, 10)
            : [],
        categoryHints: Array.isArray(payload.categoryHints)
            ? payload.categoryHints.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4)
            : [],
        attributes: Array.isArray(payload.attributes)
            ? payload.attributes.map((entry) => safeString(entry)).filter(Boolean).slice(0, 8)
            : [],
        confidence: clamp(payload.confidence, 0, 1),
        provider: response.provider,
    };
};

const embedTexts = async (inputs = []) => {
    const normalized = (Array.isArray(inputs) ? inputs : [])
        .map((entry) => {
            if (typeof entry === 'string') {
                return {
                    text: safeString(entry),
                    prefix: 'search_document',
                };
            }

            return {
                text: safeString(entry?.text || ''),
                prefix: safeString(entry?.prefix || 'search_document'),
            };
        })
        .filter((entry) => entry.text)
        .slice(0, 32);

    if (normalized.length === 0 || !getBytezApiKey()) {
        return [];
    }

    const vectors = [];
    for (const entry of normalized) {
        try {
            const response = await fetchBytezModel({
                modelId: BYTEZ_TEXT_EMBEDDING_MODEL,
                body: {
                    text: `${entry.prefix}: ${entry.text}`,
                },
            });

            vectors.push(extractEmbeddingVector(response?.payload));
        } catch {
            vectors.push([]);
        }
    }

    return vectors;
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

const rerankDocuments = async ({ query = '', documents = [], topN = 12 }) => localRerank({
    query,
    documents,
    topN,
});

const getCapabilitySnapshot = () => ({
    locale: AI_DEFAULT_LOCALE,
    reasoning: getBytezApiKey() ? 'bytez' : 'local',
    embeddings: getBytezApiKey() ? 'bytez' : 'local',
    rerank: getBytezApiKey() ? 'bytez_semantic' : 'local',
    speechToText: getBytezApiKey() ? 'bytez_ready' : 'browser_fallback',
    textToSpeech: getBytezApiKey() ? 'bytez_ready' : 'browser_fallback',
    vision: getBytezApiKey() ? 'bytez' : 'heuristic',
    models: {
        chat: BYTEZ_CHAT_MODEL,
        vision: BYTEZ_VISION_MODEL,
        embeddings: BYTEZ_TEXT_EMBEDDING_MODEL,
        audio: BYTEZ_AUDIO_MODEL,
        tts: BYTEZ_TTS_MODEL,
    },
});

const createVoiceSessionConfig = ({ userId = '', locale = AI_DEFAULT_LOCALE } = {}) => {
    const capabilities = getCapabilitySnapshot();
    const effectiveLocale = safeString(locale || capabilities.locale || AI_DEFAULT_LOCALE);
    const hasBytez = capabilities.reasoning === 'bytez';

    return {
        sessionId: `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        expiresAt: new Date(Date.now() + (10 * 60 * 1000)).toISOString(),
        locale: effectiveLocale,
        userId: safeString(userId || ''),
        realtimeEnabled: false,
        supportsAudioUpload: false,
        supportsServerInterpretation: true,
        turnEndpoint: '/api/ai/chat',
        capabilities: {
            speechToText: {
                provider: hasBytez ? 'bytez' : 'browser_fallback',
                mode: hasBytez ? 'hybrid' : 'browser_fallback',
                languageHints: ['en-IN', 'hi-IN'],
                model: BYTEZ_AUDIO_MODEL,
            },
            textToSpeech: {
                provider: hasBytez ? 'bytez' : 'browser_fallback',
                mode: hasBytez ? 'server_ready' : 'browser_fallback',
                voiceId: hasBytez ? BYTEZ_TTS_MODEL : 'browser-default',
            },
        },
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
};
