import { prepareTraceHeaders } from './clientObservability';

const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');
const normalizePath = (path = '') => (String(path || '').startsWith('/')
    ? String(path || '')
    : `/${String(path || '')}`);

export const API_BASE_URL = trimTrailingSlash(import.meta.env.VITE_API_URL || '/api');

const deriveServiceBaseUrl = () => {
    const raw = trimTrailingSlash(API_BASE_URL);
    if (!raw) return '';

    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            const pathname = trimTrailingSlash(url.pathname);
            if (pathname === '/api') {
                return trimTrailingSlash(`${url.origin}`);
            }
            return trimTrailingSlash(`${url.origin}${pathname.replace(/\/api$/i, '')}`);
        } catch {
            return '';
        }
    }

    if (typeof window !== 'undefined') {
        return trimTrailingSlash(window.location.origin);
    }

    return '';
};

export const SERVICE_BASE_URL = deriveServiceBaseUrl();

export const buildApiUrl = (path = '') => {
    return `${API_BASE_URL}${normalizePath(path)}`;
};

export const buildServiceUrl = (path = '') => {
    const normalizedPath = normalizePath(path);
    return SERVICE_BASE_URL
        ? `${SERVICE_BASE_URL}${normalizedPath}`
        : normalizedPath;
};

export const parseJsonSafely = async (response) => {
    const text = await response.text();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const createApiError = (message, status = 0, data = null, meta = {}) => {
    const error = new Error(message);
    error.status = status;
    error.data = data;
    Object.assign(error, meta);
    return error;
};

const isRetryableStatus = (status) => status >= 500 || status === 429;

const extractMessageFromData = (data, status, fallbackMessage = '') => {
    if (data && typeof data === 'object') {
        if (typeof data.message === 'string' && data.message.trim()) {
            return data.message.trim();
        }

        if (Array.isArray(data.errors) && data.errors.length > 0) {
            const combinedMessages = data.errors
                .map((issue) => String(issue?.message || '').trim())
                .filter(Boolean)
                .join(', ');
            if (combinedMessages) {
                return combinedMessages;
            }
        }
    }

    if (typeof data === 'string' && data.trim()) {
        return data.trim();
    }

    return fallbackMessage || `Request failed with status ${status}`;
};

const getResolvedUrl = (input, resolveWithApiBase = false) => {
    if (typeof Request !== 'undefined' && input instanceof Request) {
        return input.url;
    }

    if (input instanceof URL) {
        return input.toString();
    }

    const raw = String(input || '');
    return resolveWithApiBase ? buildApiUrl(raw) : raw;
};

const appendParamsToUrl = (url, params) => {
    if (!params || typeof params !== 'object') return url;

    const cleanParams = Object.fromEntries(
        Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== '')
    );

    if (Object.keys(cleanParams).length === 0) {
        return url;
    }

    const rawUrl = String(url || '');
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const resolvedUrl = new URL(rawUrl, baseOrigin);

    Object.entries(cleanParams).forEach(([key, value]) => {
        resolvedUrl.searchParams.append(key, String(value));
    });

    return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(rawUrl)
        ? resolvedUrl.toString()
        : `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
};

const getRequestMethod = (method, input) => String(
    method
    || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
    || 'GET'
).toUpperCase();

export const createResponseError = async (response, fallbackMessage = 'Request failed', meta = {}) => {
    const data = await parseJsonSafely(response.clone());
    const serverRequestId = response.headers.get('x-request-id')
        || (data && typeof data === 'object' ? data.requestId : '')
        || meta.serverRequestId
        || meta.requestId
        || '';

    return createApiError(
        extractMessageFromData(data, response.status, fallbackMessage),
        response.status,
        data,
        {
            method: meta.method || 'GET',
            requestId: meta.requestId || serverRequestId,
            serverRequestId,
            url: response.url || meta.url || '',
            durationMs: meta.durationMs,
        }
    );
};

export const requestWithTrace = async (input, options = {}) => {
    const {
        method = 'GET',
        headers = {},
        body,
        params,
        timeoutMs = 12000,
        retries,
        signal,
        credentials,
        cache,
        keepalive,
        throwOnHttpError = true,
        fallbackMessage = '',
        resolveWithApiBase = false,
    } = options;

    const requestMethod = getRequestMethod(method, input);
    const normalizedRetries = Number.isInteger(retries)
        ? retries
        : requestMethod === 'GET'
            ? 1
            : 0;

    const url = appendParamsToUrl(getResolvedUrl(input, resolveWithApiBase), params);

    let attempt = 0;

    while (attempt <= normalizedRetries) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const abortExternal = () => controller.abort();
        const trace = prepareTraceHeaders(url, headers);
        const startedAt = Date.now();

        if (signal) {
            if (signal.aborted) {
                clearTimeout(timeoutId);
                throw createApiError('Request cancelled', 0, null, {
                    method: requestMethod,
                    requestId: trace.requestId,
                    serverRequestId: trace.requestId,
                    url,
                });
            }
            signal.addEventListener('abort', abortExternal, { once: true });
        }

        try {
            const response = await fetch(url, {
                method: requestMethod,
                headers: trace.headers,
                body,
                credentials,
                cache,
                keepalive,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            const durationMs = Date.now() - startedAt;
            if (attempt < normalizedRetries && isRetryableStatus(response.status)) {
                attempt += 1;
                continue;
            }

            if (!response.ok && throwOnHttpError) {
                throw await createResponseError(
                    response,
                    fallbackMessage,
                    {
                        method: requestMethod,
                        requestId: trace.requestId,
                        url,
                        durationMs,
                    }
                );
            }

            return response;
        } catch (error) {
            clearTimeout(timeoutId);

            if (signal) {
                signal.removeEventListener('abort', abortExternal);
            }

            if (error?.name === 'AbortError') {
                if (signal?.aborted) {
                    throw createApiError('Request cancelled', 0, null, {
                        method: requestMethod,
                        requestId: trace.requestId,
                        serverRequestId: trace.requestId,
                        url,
                        durationMs: Date.now() - startedAt,
                    });
                }
                if (attempt < normalizedRetries && requestMethod === 'GET') {
                    attempt += 1;
                    continue;
                }
                throw createApiError('Request timed out', 0, null, {
                    method: requestMethod,
                    requestId: trace.requestId,
                    serverRequestId: trace.requestId,
                    url,
                    durationMs: Date.now() - startedAt,
                });
            }

            if (attempt < normalizedRetries && requestMethod === 'GET' && !error?.status) {
                attempt += 1;
                continue;
            }

            if (error instanceof Error && !error.requestId) {
                error.requestId = trace.requestId;
                error.serverRequestId = trace.requestId;
                error.method = requestMethod;
                error.url = url;
                error.durationMs = Date.now() - startedAt;
            }

            throw error;
        } finally {
            if (signal) {
                signal.removeEventListener('abort', abortExternal);
            }
        }
    }

    throw createApiError('Request failed', 0);
};

export const apiFetch = async (path, options = {}) => {
    const response = await requestWithTrace(path, {
        ...options,
        resolveWithApiBase: true,
    });

    return {
        response,
        data: await parseJsonSafely(response),
    };
};
