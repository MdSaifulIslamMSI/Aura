const crypto = require('crypto');
const {
    buildAssistantTurn,
    normalizeCitations,
    normalizeToolRuns,
    normalizeVerification,
    safeString,
} = require('../ai/assistantContract');
const logger = require('../../utils/logger');
const {
    getBundleVersionInfo,
    listGroundingSources,
} = require('./knowledgeBundleService');

const DEFAULT_REASONING_MODEL = 'gemma-4-31b-it';
const DEFAULT_ROUTER_MODEL = 'gemma-4-31b-it';
const INTELLIGENCE_MODES = new Set(['off', 'hybrid', 'always']);
const SYSTEM_AWARENESS_PATTERN = /\b(app|architecture|backend|bug|client|code|component|controller|db|debug|diagnostic|endpoint|error|explain|file|flow|frontend|function|graph|health|how does|implementation|index|issue|line by line|model|orchestrat|path|repo|route|schema|service|socket|support video|system|trace|where is|why .*fail)\b/i;
const COMMERCE_ASSIST_PATTERN = /\b(add to cart|bag|brand|browse|buy|cart|catalog|category|checkout|compare|deal|discount|find|laptop|listing|order|payment|price|product|recommend|sale|search|shop|show me|sku|track order|wishlist)\b/i;
const REPO_FILE_HINT_PATTERN = /\b(?:(?:app|server|docs|infra)\/[^\s"'`]+|[A-Za-z0-9_.-]+)\.(?:js|jsx|ts|tsx|py|md|json|ya?ml|toml|ps1|sh)\b/i;
const API_ENDPOINT_HINT_PATTERN = /\/api\/[A-Za-z0-9_:/.-]+/i;

const resolveGatewayMode = () => {
    const raw = safeString(process.env.CENTRAL_INTELLIGENCE_MODE || 'hybrid').toLowerCase();
    return INTELLIGENCE_MODES.has(raw) ? raw : 'hybrid';
};

const resolveIntelligenceServiceUrl = () => safeString(process.env.INTELLIGENCE_SERVICE_URL || '');
const resolveGatewayTimeoutMs = () => Math.max(1000, Number(process.env.INTELLIGENCE_SERVICE_TIMEOUT_MS || 180000));
const resolveGatewayStreamTimeoutMs = () => Math.max(
    60000,
    Number(process.env.INTELLIGENCE_SERVICE_STREAM_TIMEOUT_MS || Math.max(resolveGatewayTimeoutMs() * 2, 600000)),
);

const createTraceId = () => `trace_${crypto.randomUUID()}`;
const hasRepoHint = (message = '') => REPO_FILE_HINT_PATTERN.test(safeString(message)) || API_ENDPOINT_HINT_PATTERN.test(safeString(message));
const canAttemptLiveRepoFallback = ({ message = '' } = {}) => hasRepoHint(message);

const createSafeResponse = ({
    message = '',
    answerMode = 'app_grounded',
    verificationSummary = '',
    traceId = createTraceId(),
    bundleInfo = {},
    reason = '',
    staleBundle = false,
    missingEvidence = false,
} = {}) => {
    const responseText = safeString(message) || 'I could not verify that from the current system state.';
    const assistantTurn = buildAssistantTurn({
        intent: 'general_knowledge',
        decision: 'respond',
        response: responseText,
        ui: {
            surface: 'plain_answer',
        },
        followUps: [
            'Ask about a specific file or route',
            'Ask me to trace the flow step by step',
        ],
        citations: [],
        toolRuns: [],
        verification: {
            label: 'cannot_verify',
            confidence: 0,
            summary: verificationSummary || responseText,
            evidenceCount: 0,
        },
        answerMode,
    });

    return {
        answer: responseText,
        actions: [],
        followUps: assistantTurn.followUps,
        assistantTurn,
        grounding: {
            mode: answerMode,
            status: 'cannot_verify',
            reason: safeString(reason || ''),
            staleBundle: Boolean(staleBundle),
            missingEvidence: Boolean(missingEvidence),
            evidenceCount: 0,
            sources: [],
            bundleVersion: safeString(bundleInfo.bundleVersion || ''),
            traceId,
        },
        provider: 'central-intelligence',
        providerModel: DEFAULT_REASONING_MODEL,
        providerInfo: {
            name: 'central-intelligence',
            model: DEFAULT_REASONING_MODEL,
        },
        latencyMs: 0,
    };
};

const fetchJson = async (url, options = {}) => {
    const controller = new AbortController();
    const timeoutMs = resolveGatewayTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        });
        const text = await response.text();
        let json = {};
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            json = {
                raw: text,
            };
        }
        return {
            ok: response.ok,
            status: response.status,
            json,
        };
    } finally {
        clearTimeout(timeout);
    }
};

const consumeSseStream = async (response, onEvent = () => {}) => {
    const reader = response.body?.getReader?.();
    if (!reader) {
        throw new Error('Intelligence stream did not expose a readable body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';

        frames.forEach((frame) => {
            const lines = String(frame || '').split('\n').map((line) => line.trimEnd());
            const eventLine = lines.find((line) => line.startsWith('event:'));
            const dataLines = lines.filter((line) => line.startsWith('data:'));
            const eventName = safeString(String(eventLine || '').replace(/^event:\s*/, ''), 'message');
            const rawData = dataLines
                .map((line) => String(line || '').replace(/^data:\s*/, ''))
                .join('\n')
                .trim();

            if (!rawData) {
                return;
            }

            try {
                onEvent(eventName, JSON.parse(rawData));
            } catch {
                onEvent(eventName, { raw: rawData });
            }
        });
    }
};

const shouldUseCentralIntelligence = ({
    message = '',
    confirmation = null,
    actionRequest = null,
    assistantMode = 'chat',
    context = {},
} = {}) => {
    const serviceUrl = resolveIntelligenceServiceUrl();
    if (!serviceUrl) return false;

    const mode = resolveGatewayMode();
    if (mode === 'off') return false;
    if (confirmation?.actionId || actionRequest?.type || assistantMode === 'voice') {
        return false;
    }
    if (context?.forceCentralIntelligence === true) return true;
    const normalizedMessage = safeString(message);
    if (!normalizedMessage) return false;

    if (mode === 'always') {
        if (SYSTEM_AWARENESS_PATTERN.test(normalizedMessage) || hasRepoHint(normalizedMessage)) {
            return true;
        }
        if (COMMERCE_ASSIST_PATTERN.test(normalizedMessage)) {
            return false;
        }
        return true;
    }

    return SYSTEM_AWARENESS_PATTERN.test(normalizedMessage) || hasRepoHint(normalizedMessage);
};

const buildAssistantRequest = ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    context = {},
    images = [],
    session = {},
    bundleInfo = {},
} = {}) => ({
    traceId: createTraceId(),
    bundleVersion: safeString(bundleInfo.bundleVersion || ''),
    expectedBundleVersion: safeString(bundleInfo.expectedCommitSha || bundleInfo.bundleVersion || ''),
    request: {
        message: safeString(message),
        assistantMode: safeString(assistantMode || 'chat') || 'chat',
        conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
        images: Array.isArray(images) ? images : [],
    },
    userContext: {
        id: safeString(user?._id || ''),
        isAdmin: Boolean(user?.isAdmin),
        isAuthenticated: Boolean(user?._id),
    },
    runtimeContext: {
        route: safeString(context?.route || ''),
        routeLabel: safeString(context?.routeLabel || ''),
        cartSummary: context?.cartSummary && typeof context.cartSummary === 'object' ? context.cartSummary : null,
        currentProductId: safeString(context?.currentProductId || ''),
        sessionId: safeString(session?.sessionId || ''),
        contextVersion: Number(session?.contextVersion || 0),
        sessionMemory: context?.sessionMemory && typeof context.sessionMemory === 'object' ? context.sessionMemory : {},
    },
    providerConfig: {
        routingModel: safeString(
            process.env.INTELLIGENCE_ROUTING_MODEL || process.env.INTELLIGENCE_ROUTER_MODEL || DEFAULT_ROUTER_MODEL,
        ),
        reasoningModel: safeString(process.env.INTELLIGENCE_REASONING_MODEL || DEFAULT_REASONING_MODEL),
        endpointProvider: safeString(process.env.INTELLIGENCE_PROVIDER || 'google_gemini'),
    },
});

const normalizeCentralIntelligenceReply = async ({
    reply = {},
    bundleInfo = {},
    traceId = createTraceId(),
} = {}) => {
    const citations = normalizeCitations(reply?.assistantTurn?.citations || reply?.citations || []);
    const toolRuns = normalizeToolRuns(reply?.assistantTurn?.toolRuns || reply?.toolRuns || []);
    const verification = normalizeVerification(reply?.assistantTurn?.verification || reply?.verification || {});
    const answerMode = safeString(reply?.grounding?.mode || reply?.assistantTurn?.answerMode || 'app_grounded') || 'app_grounded';
    const responseText = safeString(reply?.assistantTurn?.response || reply?.answer || '');

    const assistantTurn = buildAssistantTurn({
        intent: reply?.assistantTurn?.intent || 'general_knowledge',
        entities: reply?.assistantTurn?.entities || {},
        confidence: Number(reply?.assistantTurn?.confidence || 0.75),
        decision: reply?.assistantTurn?.decision || 'respond',
        response: responseText,
        actions: reply?.assistantTurn?.actions || reply?.actions || [],
        ui: reply?.assistantTurn?.ui || {
            surface: 'plain_answer',
        },
        contextPatch: reply?.assistantTurn?.contextPatch || {},
        followUps: reply?.assistantTurn?.followUps || reply?.followUps || [],
        safetyFlags: reply?.assistantTurn?.safetyFlags || [],
        citations,
        toolRuns,
        verification,
        policy: reply?.assistantTurn?.policy || null,
        sessionMemory: reply?.assistantTurn?.sessionMemory || null,
        answerMode,
    });

    const sources = Array.isArray(reply?.grounding?.sources) && reply.grounding.sources.length > 0
        ? reply.grounding.sources
        : await listGroundingSources({ citations });
    const providerName = safeString(reply?.provider?.name || reply?.providerName || reply?.provider || 'central-intelligence');
    const providerModel = safeString(reply?.provider?.model || reply?.providerModel || DEFAULT_REASONING_MODEL);

    return {
        answer: assistantTurn.response,
        actions: assistantTurn.actions,
        followUps: assistantTurn.followUps,
        assistantTurn,
        grounding: {
            mode: answerMode,
            status: safeString(reply?.grounding?.status || (verification.label === 'cannot_verify' ? 'cannot_verify' : 'verified')) || 'verified',
            reason: safeString(reply?.grounding?.reason || ''),
            staleBundle: Boolean(reply?.grounding?.staleBundle),
            missingEvidence: Boolean(reply?.grounding?.missingEvidence),
            evidenceCount: Math.max(0, Number(reply?.grounding?.evidenceCount || verification?.evidenceCount || 0)),
            sources,
            bundleVersion: safeString(reply?.grounding?.bundleVersion || bundleInfo.bundleVersion || ''),
            traceId: safeString(reply?.grounding?.traceId || traceId) || traceId,
        },
        provider: providerName,
        providerModel,
        providerInfo: {
            name: providerName,
            model: providerModel,
        },
        latencyMs: Math.max(0, Number(reply?.latencyMs || 0)),
    };
};

const requestCentralIntelligenceTurn = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    context = {},
    images = [],
    session = {},
} = {}) => {
    const serviceUrl = resolveIntelligenceServiceUrl();
    if (!serviceUrl) {
        return null;
    }

    const bundleInfo = await getBundleVersionInfo();
    const traceId = createTraceId();

    if (bundleInfo.stale && !canAttemptLiveRepoFallback({ message })) {
        return createSafeResponse({
            message: 'I cannot verify app-specific details because the active knowledge bundle does not match the deployed app version.',
            verificationSummary: 'Bundle version mismatch. Regenerate and publish the active knowledge bundle before trusting app-grounded answers.',
            traceId,
            bundleInfo,
            reason: 'stale_bundle',
            staleBundle: true,
        });
    }

    const payload = buildAssistantRequest({
        user,
        message,
        conversationHistory,
        assistantMode,
        context,
        images,
        session,
        bundleInfo,
    });
    payload.traceId = traceId;
    payload.providerConfig = {
        ...(payload.providerConfig || {}),
        allowStaleWorkspaceFallback: Boolean(bundleInfo.stale && canAttemptLiveRepoFallback({ message })),
    };

    const { ok, status, json } = await fetchJson(`${serviceUrl}/v1/assistant/reply`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
            Authorization: `Bearer ${safeString(process.env.INTELLIGENCE_SERVICE_TOKEN || process.env.AI_INTERNAL_TOOL_SECRET || '')}`,
            'X-Intelligence-Trace-Id': traceId,
        },
    });

    if (!ok) {
        logger.warn('intelligence.gateway_request_failed', {
            status,
            traceId,
            messagePreview: safeString(message).slice(0, 120),
        });
        return createSafeResponse({
            message: 'The system-aware intelligence layer is unavailable right now, so I cannot verify repo-grounded details.',
            verificationSummary: `Intelligence service request failed with status ${status}.`,
            traceId,
            bundleInfo,
            reason: 'service_unavailable',
        });
    }

    const normalizedReply = await normalizeCentralIntelligenceReply({
        reply: json,
        bundleInfo,
        traceId,
    });

    logger.info('intelligence.gateway_reply', {
        traceId: normalizedReply.grounding?.traceId || traceId,
        bundleVersion: normalizedReply.grounding?.bundleVersion || bundleInfo.bundleVersion,
        mode: normalizedReply.grounding?.mode || 'app_grounded',
        citationCount: Array.isArray(normalizedReply.assistantTurn?.citations)
            ? normalizedReply.assistantTurn.citations.length
            : 0,
        toolRunCount: Array.isArray(normalizedReply.assistantTurn?.toolRuns)
            ? normalizedReply.assistantTurn.toolRuns.length
            : 0,
        verification: normalizedReply.assistantTurn?.verification?.label || 'cannot_verify',
    });

    return normalizedReply;
};

const streamCentralIntelligenceTurn = async ({
    writeEvent,
    ...params
} = {}) => {
    if (typeof writeEvent !== 'function') {
        throw new Error('writeEvent callback is required for streaming');
    }

    const serviceUrl = resolveIntelligenceServiceUrl();
    if (!serviceUrl) {
        return null;
    }

    const bundleInfo = await getBundleVersionInfo();
    const traceId = createTraceId();

    if (bundleInfo.stale && !canAttemptLiveRepoFallback({ message: params.message })) {
        return createSafeResponse({
            message: 'I cannot verify app-specific details because the active knowledge bundle does not match the deployed app version.',
            verificationSummary: 'Bundle version mismatch. Regenerate and publish the active knowledge bundle before trusting app-grounded answers.',
            traceId,
            bundleInfo,
            reason: 'stale_bundle',
            staleBundle: true,
        });
    }

    const payload = buildAssistantRequest({
        ...params,
        bundleInfo,
    });
    payload.traceId = traceId;
    payload.providerConfig = {
        ...(payload.providerConfig || {}),
        allowStaleWorkspaceFallback: Boolean(bundleInfo.stale && canAttemptLiveRepoFallback({ message: params.message })),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), resolveGatewayStreamTimeoutMs());

    try {
        const response = await fetch(`${serviceUrl}/v1/assistant/reply/stream`, {
            method: 'POST',
            signal: controller.signal,
            body: JSON.stringify(payload),
            headers: {
                Accept: 'text/event-stream',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${safeString(process.env.INTELLIGENCE_SERVICE_TOKEN || process.env.AI_INTERNAL_TOOL_SECRET || '')}`,
                'X-Intelligence-Trace-Id': traceId,
            },
        });

        if (!response.ok) {
            logger.warn('intelligence.gateway_stream_failed', {
                status: response.status,
                traceId,
                messagePreview: safeString(params.message).slice(0, 120),
            });
            return createSafeResponse({
                message: 'The system-aware intelligence layer is unavailable right now, so I cannot verify repo-grounded details.',
                verificationSummary: `Intelligence streaming request failed with status ${response.status}.`,
                traceId,
                bundleInfo,
                reason: 'service_unavailable',
            });
        }

        let finalReply = null;
        await consumeSseStream(response, (eventName, data) => {
            if (eventName === 'final_turn') {
                finalReply = data;
                return;
            }

            writeEvent(eventName, data);
        });

        if (!finalReply) {
            return createSafeResponse({
                message: 'The system-aware intelligence layer ended without a final verified answer.',
                verificationSummary: 'The intelligence stream closed before emitting a final turn.',
                traceId,
                bundleInfo,
                reason: 'stream_incomplete',
            });
        }

        const normalizedReply = await normalizeCentralIntelligenceReply({
            reply: finalReply,
            bundleInfo,
            traceId,
        });

        logger.info('intelligence.gateway_stream_reply', {
            traceId: normalizedReply.grounding?.traceId || traceId,
            bundleVersion: normalizedReply.grounding?.bundleVersion || bundleInfo.bundleVersion,
            mode: normalizedReply.grounding?.mode || 'app_grounded',
            citationCount: Array.isArray(normalizedReply.assistantTurn?.citations)
                ? normalizedReply.assistantTurn.citations.length
                : 0,
            toolRunCount: Array.isArray(normalizedReply.assistantTurn?.toolRuns)
                ? normalizedReply.assistantTurn.toolRuns.length
                : 0,
            verification: normalizedReply.assistantTurn?.verification?.label || 'cannot_verify',
        });

        return normalizedReply;
    } finally {
        clearTimeout(timeout);
    }
};

const getCentralIntelligenceHealth = async () => {
    const serviceUrl = resolveIntelligenceServiceUrl();
    const bundleInfo = await getBundleVersionInfo();
    const mode = resolveGatewayMode();

    if (!serviceUrl || mode === 'off') {
        return {
            enabled: false,
            healthy: false,
            mode,
            bundleVersion: bundleInfo.bundleVersion,
            staleBundle: bundleInfo.stale,
            reason: serviceUrl ? 'gateway_disabled' : 'service_url_missing',
        };
    }

    try {
        const { ok, status, json } = await fetchJson(`${serviceUrl}/health`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${safeString(process.env.INTELLIGENCE_SERVICE_TOKEN || process.env.AI_INTERNAL_TOOL_SECRET || '')}`,
            },
        });
        return {
            enabled: true,
            healthy: ok,
            mode,
            bundleVersion: bundleInfo.bundleVersion,
            staleBundle: bundleInfo.stale,
            statusCode: status,
            service: json,
        };
    } catch (error) {
        return {
            enabled: true,
            healthy: false,
            mode,
            bundleVersion: bundleInfo.bundleVersion,
            staleBundle: bundleInfo.stale,
            reason: error.message,
        };
    }
};

module.exports = {
    getCentralIntelligenceHealth,
    requestCentralIntelligenceTurn,
    shouldUseCentralIntelligence,
    streamCentralIntelligenceTurn,
};
