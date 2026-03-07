export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const buildApiUrl = (path = '') => {
    const normalizedPath = String(path || '').startsWith('/')
        ? String(path || '')
        : `/${String(path || '')}`;

    return `${API_BASE_URL}${normalizedPath}`;
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

const createApiError = (message, status = 0, data = null) => {
    const error = new Error(message);
    error.status = status;
    error.data = data;
    return error;
};

const isRetryableStatus = (status) => status >= 500 || status === 429;

export const apiFetch = async (path, options = {}) => {
    const {
        method = 'GET',
        headers = {},
        body,
        params,
        timeoutMs = 12000,
        retries,
        signal,
        credentials,
    } = options;

    const requestMethod = String(method || 'GET').toUpperCase();
    const normalizedRetries = Number.isInteger(retries)
        ? retries
        : requestMethod === 'GET'
            ? 1
            : 0;

    const url = (() => {
        const baseUrl = buildApiUrl(path);
        if (!params || typeof params !== 'object') return baseUrl;

        const cleanParams = Object.fromEntries(
            Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== '')
        );

        const queryString = new URLSearchParams(cleanParams).toString();
        return queryString ? `${baseUrl}?${queryString}` : baseUrl;
    })();

    let attempt = 0;

    while (attempt <= normalizedRetries) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const abortExternal = () => controller.abort();

        if (signal) {
            if (signal.aborted) {
                clearTimeout(timeoutId);
                throw createApiError('Request cancelled', 0);
            }
            signal.addEventListener('abort', abortExternal, { once: true });
        }

        try {
            const response = await fetch(url, {
                method: requestMethod,
                headers,
                body,
                credentials,
                signal: controller.signal,
            });

            const data = await parseJsonSafely(response);
            clearTimeout(timeoutId);

            if (response.ok) {
                return { response, data };
            }

            const message = typeof data === 'object' && data
                ? data.message || (Array.isArray(data.errors) ? data.errors.map((issue) => issue.message).join(', ') : '')
                : '';

            const error = createApiError(
                message || `Request failed with status ${response.status}`,
                response.status,
                data
            );

            if (attempt < normalizedRetries && isRetryableStatus(response.status)) {
                attempt += 1;
                continue;
            }

            throw error;
        } catch (error) {
            clearTimeout(timeoutId);

            if (signal) {
                signal.removeEventListener('abort', abortExternal);
            }

            if (error?.name === 'AbortError') {
                if (signal?.aborted) {
                    throw createApiError('Request cancelled', 0);
                }
                if (attempt < normalizedRetries && requestMethod === 'GET') {
                    attempt += 1;
                    continue;
                }
                throw createApiError('Request timed out', 0);
            }

            if (attempt < normalizedRetries && requestMethod === 'GET' && !error?.status) {
                attempt += 1;
                continue;
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
