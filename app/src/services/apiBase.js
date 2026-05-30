import { prepareTraceHeaders } from './clientObservability';
import { getSafeEnv, resolveApiBaseUrl, trimTrailingSlash } from './runtimeApiConfig';
import { getActiveMarketHeaders } from './marketRuntime';
import { ADMIN_ACCESS_LOCK_EVENT, getAdminAccessLockPayload } from '../utils/adminAccessLock';

const normalizePath = (path = '') => (String(path || '').startsWith('/')
    ? String(path || '')
    : `/${String(path || '')}`);

export const API_BASE_URL = trimTrailingSlash(resolveApiBaseUrl('/api'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const EMERGENCY_RESPONSE_CODES = new Set([
    'FEATURE_TEMPORARILY_DISABLED',
    'MAINTENANCE_MODE',
    'READ_ONLY_MODE',
]);

const emitEmergencyStatusRefresh = ({ status = 0, data = null, requestId = '' } = {}) => {
    if (typeof window === 'undefined') return;
    if (![423, 503].includes(Number(status))) return;
    const code = data && typeof data === 'object' ? String(data.code || '') : '';
    if (!EMERGENCY_RESPONSE_CODES.has(code)) return;
    window.dispatchEvent(new CustomEvent('aura:emergency-status:refresh', {
        detail: { status, code, requestId },
    }));
};

const emitAdminAccessLock = ({ status = 0, data = null, requestId = '', url = '' } = {}) => {
    if (typeof window === 'undefined') return;
    const detail = getAdminAccessLockPayload({ status, data, requestId, url });
    if (!detail) return;
    window.dispatchEvent(new CustomEvent(ADMIN_ACCESS_LOCK_EVENT, { detail }));
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
    emitEmergencyStatusRefresh({
        status: response.status,
        data,
        requestId: serverRequestId,
    });
    emitAdminAccessLock({
        status: response.status,
        data,
        requestId: serverRequestId,
        url: response.url || meta.url || '',
    });

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
        const trace = prepareTraceHeaders(url, {
            ...getActiveMarketHeaders(),
            ...headers,
        });
        const dpopProof = await createDpopProof(requestMethod, url);
        if (dpopProof) {
            trace.headers.set('DPoP', dpopProof);
        }
        const startedAt = Date.now();

        // Default to JSON if body is present and it's a string, and Content-Type is not set
        if (body && typeof body === 'string' && !trace.headers.has('Content-Type')) {
            trace.headers.set('Content-Type', 'application/json');
        }
        if (!trace.headers.has('Accept')) {
            trace.headers.set('Accept', 'application/json');
        }

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
                const delay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 200, 10000);
                await sleep(delay);
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
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 200, 10000);
                    await sleep(delay);
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
                const delay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 200, 10000);
                await sleep(delay);
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
        credentials: options.credentials ?? 'include',
        ...options,
        resolveWithApiBase: true,
    });

    return {
        response,
        data: await parseJsonSafely(response),
    };
};

const DPOP_DB_NAME = 'aura_dpop_keys';
const DPOP_STORE_NAME = 'keys';
const DPOP_KEY_ID = 'browser-session-binding-v1';

let dpopKeyPair = null;
let dpopKeyPairPromise = null;
let dpopDbPromise = null;

const canUseDpopCrypto = () => (
    typeof window !== 'undefined'
    && window.crypto
    && window.crypto.subtle
);

const openDpopDatabase = () => {
    if (typeof window === 'undefined' || !window.indexedDB) {
        return Promise.resolve(null);
    }
    if (dpopDbPromise) return dpopDbPromise;

    dpopDbPromise = new Promise((resolve) => {
        let request;
        try {
            request = window.indexedDB.open(DPOP_DB_NAME, 1);
        } catch {
            resolve(null);
            return;
        }

        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DPOP_STORE_NAME)) {
                db.createObjectStore(DPOP_STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
    });

    return dpopDbPromise;
};

const readStoredDpopKeyPair = async () => {
    const db = await openDpopDatabase();
    if (!db) return null;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(DPOP_STORE_NAME, 'readonly');
            const store = tx.objectStore(DPOP_STORE_NAME);
            const request = store.get(DPOP_KEY_ID);
            request.onerror = () => resolve(null);
            request.onsuccess = () => {
                const keyPair = request.result?.keyPair || null;
                if (keyPair?.privateKey && keyPair?.publicKey) {
                    resolve(keyPair);
                    return;
                }
                resolve(null);
            };
        } catch {
            resolve(null);
        }
    });
};

const writeStoredDpopKeyPair = async (keyPair) => {
    const db = await openDpopDatabase();
    if (!db || !keyPair?.privateKey || !keyPair?.publicKey) return;

    await new Promise((resolve) => {
        try {
            const tx = db.transaction(DPOP_STORE_NAME, 'readwrite');
            const store = tx.objectStore(DPOP_STORE_NAME);
            const request = store.put({
                id: DPOP_KEY_ID,
                keyPair,
                createdAt: new Date().toISOString(),
            });
            request.onerror = () => resolve();
            request.onsuccess = () => resolve();
        } catch {
            resolve();
        }
    });
};

const generateDpopKeyPair = () => window.crypto.subtle.generateKey(
    {
        name: 'ECDSA',
        namedCurve: 'P-256'
    },
    false,
    ['sign', 'verify']
);

const getOrCreateDpopKeyPair = async () => {
    if (!canUseDpopCrypto()) {
        return null;
    }
    if (dpopKeyPair) {
        return dpopKeyPair;
    }
    if (dpopKeyPairPromise) {
        return dpopKeyPairPromise;
    }

    try {
        dpopKeyPairPromise = (async () => {
            const storedKeyPair = await readStoredDpopKeyPair();
            if (storedKeyPair) {
                dpopKeyPair = storedKeyPair;
                return dpopKeyPair;
            }

            const generatedKeyPair = await generateDpopKeyPair();
            dpopKeyPair = generatedKeyPair;
            await writeStoredDpopKeyPair(generatedKeyPair);
            return dpopKeyPair;
        })();

        return await dpopKeyPairPromise;
    } catch (err) {
        console.warn('Failed to generate DPoP key pair:', err);
        return null;
    } finally {
        dpopKeyPairPromise = null;
    }
};

const base64url = (bufferOrString) => {
    let binary = '';
    if (typeof bufferOrString === 'string') {
        binary = bufferOrString;
    } else {
        const bytes = new Uint8Array(bufferOrString);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
};

const createDpopJti = () => {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return base64url(bytes);
};

const createDpopProof = async (method, url) => {
    const keyPair = await getOrCreateDpopKeyPair();
    if (!keyPair) return null;

    try {
        const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
        const header = {
            typ: 'dpop+jwt',
            alg: 'ES256',
            jwk: {
                kty: publicKeyJwk.kty,
                crv: publicKeyJwk.crv,
                x: publicKeyJwk.x,
                y: publicKeyJwk.y
            }
        };

        let htu = url;
        try {
            const parsedUrl = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
            htu = `${parsedUrl.origin}${parsedUrl.pathname}`;
        } catch {
            // fallback
        }

        const payload = {
            jti: createDpopJti(),
            htm: method.toUpperCase(),
            htu,
            iat: Math.floor(Date.now() / 1000)
        };

        const headerBase64 = base64url(new TextEncoder().encode(JSON.stringify(header)));
        const payloadBase64 = base64url(new TextEncoder().encode(JSON.stringify(payload)));
        const signingInput = `${headerBase64}.${payloadBase64}`;

        const signatureBuffer = await window.crypto.subtle.sign(
            {
                name: 'ECDSA',
                hash: { name: 'SHA-256' }
            },
            keyPair.privateKey,
            new TextEncoder().encode(signingInput)
        );

        const signatureBase64 = base64url(signatureBuffer);
        return `${signingInput}.${signatureBase64}`;
    } catch (err) {
        console.warn('Failed to sign DPoP proof:', err);
        return null;
    }
};
