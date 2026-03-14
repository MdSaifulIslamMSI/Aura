const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');
const API_BASE_URL = trimTrailingSlash(import.meta.env.VITE_API_URL || '/api');
const CLIENT_SESSION_STORAGE_KEY = 'aura_observability_session_id';
const DEBUG_STORE_KEY = '__AURA_OBSERVABILITY__';
const FETCH_PATCH_FLAG = '__AURA_FETCH_PATCHED__';
const ERROR_PATCH_FLAG = '__AURA_ERROR_PATCHED__';
const LIFECYCLE_PATCH_FLAG = '__AURA_OBSERVABILITY_LIFECYCLE_PATCHED__';
export const CLIENT_DIAGNOSTIC_EVENT = 'aura:client-diagnostic';
const MAX_BUFFERED_EVENTS = 60;
const MAX_PENDING_DIAGNOSTICS = 30;
const DIAGNOSTIC_FLUSH_BATCH_SIZE = 10;
const DIAGNOSTIC_FLUSH_INTERVAL_MS = 15000;
const DIAGNOSTIC_FLUSH_MIN_GAP_MS = 3000;
const MAX_EVENTS_PER_MINUTE = 50;
let eventCounter = 0;
let lastCounterReset = Date.now();
const CLIENT_DIAGNOSTIC_INGEST_PATH = '/observability/client-diagnostics';
const SLOW_REQUEST_THRESHOLD_MS = 1500;
const PERSISTED_CLIENT_DIAGNOSTIC_TYPES = new Set([
    'api.network_error',
    'api.response_error',
    'client.runtime_error',
]);

const getWindowRef = () => (typeof window !== 'undefined' ? window : null);

const createId = (prefix = 'web') => {
    const cryptoRef = globalThis.crypto;
    if (cryptoRef?.randomUUID) {
        return `${prefix}-${cryptoRef.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const getCurrentRoute = () => {
    const windowRef = getWindowRef();
    if (!windowRef?.location) return '';
    return `${windowRef.location.pathname || ''}${windowRef.location.search || ''}`;
};

const getDebugStore = () => {
    const windowRef = getWindowRef();
    if (!windowRef) {
        return { sessionId: '', events: [] };
    }

    if (!windowRef[DEBUG_STORE_KEY]) {
        windowRef[DEBUG_STORE_KEY] = {
            sessionId: '',
            events: [],
            pendingDiagnostics: [],
            isFlushingDiagnostics: false,
            lastDiagnosticsFlushAt: 0,
            diagnosticsFlushTimerId: null,
            originalFetch: null,
            lifecycleHandlers: null,
            errorHandlers: null,
        };
    }

    return windowRef[DEBUG_STORE_KEY];
};

const getOriginalFetch = () => getDebugStore().originalFetch;

const isDiagnosticIngestUrl = (url = '') => {
    const requestUrl = resolveRequestUrl(url);
    const normalizedPath = trimTrailingSlash(requestUrl?.pathname || '');
    return normalizedPath === `${API_BASE_URL}${CLIENT_DIAGNOSTIC_INGEST_PATH}`
        || normalizedPath === CLIENT_DIAGNOSTIC_INGEST_PATH
        || normalizedPath.endsWith(CLIENT_DIAGNOSTIC_INGEST_PATH);
};

const getDiagnosticIngestUrl = () => `${API_BASE_URL}${CLIENT_DIAGNOSTIC_INGEST_PATH}`;

const truncateString = (value = '', maxLength = 300) => {
    const normalized = String(value || '');
    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength - 3)}...`
        : normalized;
};

const sanitizeDiagnosticPayload = (value, depth = 0) => {
    if (depth > 2) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return value.slice(0, 8).map((item) => sanitizeDiagnosticPayload(item, depth + 1));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 12)
                .map(([key, entryValue]) => [key, sanitizeDiagnosticPayload(entryValue, depth + 1)])
                .filter(([, entryValue]) => entryValue !== undefined)
        );
    }

    if (typeof value === 'string') {
        return truncateString(value, depth === 0 ? 400 : 240);
    }

    return value;
};

const sanitizeDiagnosticForTransport = (event = {}) => ({
    id: String(event.id || ''),
    type: String(event.type || ''),
    severity: String(event.severity || 'info'),
    timestamp: String(event.timestamp || new Date().toISOString()),
    route: String(event.route || ''),
    sessionId: String(event.sessionId || ''),
    url: String(event.url || ''),
    method: String(event.method || ''),
    requestId: String(event.requestId || ''),
    serverRequestId: String(event.serverRequestId || ''),
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : undefined,
    durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : undefined,
    detail: String(event.detail || ''),
    error: sanitizeDiagnosticPayload(event.error),
    context: sanitizeDiagnosticPayload(event.context),
});

const clearDiagnosticsFlushTimer = () => {
    const windowRef = getWindowRef();
    const debugStore = getDebugStore();
    if (!windowRef || !debugStore.diagnosticsFlushTimerId) return;
    windowRef.clearTimeout(debugStore.diagnosticsFlushTimerId);
    debugStore.diagnosticsFlushTimerId = null;
};

const scheduleDiagnosticsFlush = (delayMs = 2500) => {
    const windowRef = getWindowRef();
    const debugStore = getDebugStore();
    if (!windowRef || debugStore.diagnosticsFlushTimerId || !(debugStore.pendingDiagnostics || []).length) {
        return;
    }

    debugStore.diagnosticsFlushTimerId = windowRef.setTimeout(() => {
        debugStore.diagnosticsFlushTimerId = null;
        void flushBufferedClientDiagnostics();
    }, delayMs);
};

const shouldPersistClientDiagnostic = (event = {}) => {
    if (!PERSISTED_CLIENT_DIAGNOSTIC_TYPES.has(String(event.type || ''))) {
        return false;
    }

    if (isDiagnosticIngestUrl(event.url || '')) {
        return false;
    }

    return true;
};

export const flushBufferedClientDiagnostics = async ({ useBeacon = false, force = false } = {}) => {
    const windowRef = getWindowRef();
    const debugStore = getDebugStore();
    const pendingDiagnostics = debugStore.pendingDiagnostics || [];

    if (!windowRef || debugStore.isFlushingDiagnostics || pendingDiagnostics.length === 0) {
        return false;
    }

    const now = Date.now();
    if (!force && (now - Number(debugStore.lastDiagnosticsFlushAt || 0)) < DIAGNOSTIC_FLUSH_MIN_GAP_MS) {
        scheduleDiagnosticsFlush(DIAGNOSTIC_FLUSH_MIN_GAP_MS);
        return false;
    }

    if (!force && typeof navigator !== 'undefined' && navigator.onLine === false) {
        return false;
    }

    clearDiagnosticsFlushTimer();
    debugStore.isFlushingDiagnostics = true;
    const batch = pendingDiagnostics.slice(0, DIAGNOSTIC_FLUSH_BATCH_SIZE);
    const payload = JSON.stringify({ events: batch });
    let flushed = false;

    try {
        if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && typeof Blob !== 'undefined') {
            const body = new Blob([payload], { type: 'application/json' });
            flushed = navigator.sendBeacon(getDiagnosticIngestUrl(), body);
        }

        if (!flushed) {
            const originalFetch = getOriginalFetch();
            if (typeof originalFetch !== 'function') {
                return false;
            }

            const response = await originalFetch(getDiagnosticIngestUrl(), {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'X-Client-Session-Id': getClientSessionId(),
                    'X-Client-Route': getCurrentRoute(),
                    'X-Client-Diagnostic-Source': 'browser',
                },
                body: payload,
                keepalive: true,
                credentials: 'include',
            });

            flushed = Boolean(response?.ok);
        }

        if (flushed) {
            debugStore.pendingDiagnostics = debugStore.pendingDiagnostics.slice(batch.length);
        }

        return flushed;
    } catch {
        return false;
    } finally {
        debugStore.lastDiagnosticsFlushAt = Date.now();
        debugStore.isFlushingDiagnostics = false;
        if ((debugStore.pendingDiagnostics || []).length > 0 && !useBeacon) {
            scheduleDiagnosticsFlush(DIAGNOSTIC_FLUSH_INTERVAL_MS);
        }
    }
};

export const getClientSessionId = () => {
    const windowRef = getWindowRef();
    if (!windowRef) return '';

    const existingStoreId = getDebugStore().sessionId;
    if (existingStoreId) return existingStoreId;

    try {
        const existingSessionId = windowRef.sessionStorage?.getItem(CLIENT_SESSION_STORAGE_KEY);
        if (existingSessionId) {
            getDebugStore().sessionId = existingSessionId;
            return existingSessionId;
        }
    } catch {
        // Ignore sessionStorage access failures.
    }

    const nextSessionId = createId('session');
    try {
        windowRef.sessionStorage?.setItem(CLIENT_SESSION_STORAGE_KEY, nextSessionId);
    } catch {
        // Ignore sessionStorage write failures.
    }
    getDebugStore().sessionId = nextSessionId;
    return nextSessionId;
};

const getConfiguredApiDescriptor = () => {
    const windowRef = getWindowRef();
    const fallbackOrigin = windowRef?.location?.origin || 'http://localhost';

    try {
        const parsed = new URL(API_BASE_URL || '/api', fallbackOrigin);
        return {
            origin: parsed.origin,
            pathPrefix: trimTrailingSlash(parsed.pathname) || '',
        };
    } catch {
        return {
            origin: windowRef?.location?.origin || '',
            pathPrefix: '/api',
        };
    }
};

const matchesApiSurface = (url) => {
    if (!url) return false;

    const { origin, pathPrefix } = getConfiguredApiDescriptor();
    const normalizedPath = trimTrailingSlash(url.pathname);
    const apiPath = pathPrefix || '/api';
    const sameOrigin = !origin || url.origin === origin;

    if (sameOrigin && (normalizedPath === apiPath || normalizedPath.startsWith(`${apiPath}/`))) {
        return true;
    }

    return sameOrigin && (normalizedPath === '/health' || normalizedPath.startsWith('/health/'));
};

const resolveRequestUrl = (input) => {
    const windowRef = getWindowRef();
    const baseOrigin = windowRef?.location?.origin || 'http://localhost';

    try {
        if (typeof Request !== 'undefined' && input instanceof Request) {
            return new URL(input.url, baseOrigin);
        }
        return new URL(String(input || ''), baseOrigin);
    } catch {
        return null;
    }
};

const normalizeHeaders = (headersInit = undefined) => new Headers(headersInit || {});

export const prepareTraceHeaders = (input, headersInit = undefined) => {
    const requestUrl = resolveRequestUrl(input);
    const headers = normalizeHeaders(headersInit);

    if (!matchesApiSurface(requestUrl)) {
        return {
            headers,
            requestId: '',
            clientSessionId: '',
            traceable: false,
            url: requestUrl?.toString() || '',
        };
    }

    const requestId = headers.get('X-Request-Id') || createId('req');
    const clientSessionId = headers.get('X-Client-Session-Id') || getClientSessionId();
    const clientRoute = headers.get('X-Client-Route') || getCurrentRoute();

    headers.set('X-Request-Id', requestId);
    headers.set('X-Client-Session-Id', clientSessionId);
    if (clientRoute) {
        headers.set('X-Client-Route', clientRoute);
    }

    return {
        headers,
        requestId,
        clientSessionId,
        traceable: true,
        url: requestUrl?.toString() || '',
    };
};

const sanitizeStack = (stack = '') => String(stack || '').split('\n').slice(0, 12).join('\n');

export const serializeError = (error) => {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: sanitizeStack(error.stack),
            status: Number.isFinite(Number(error.status)) ? Number(error.status) : undefined,
            requestId: String(error.requestId || ''),
            serverRequestId: String(error.serverRequestId || ''),
            url: String(error.url || ''),
            method: String(error.method || ''),
            durationMs: Number.isFinite(Number(error.durationMs)) ? Number(error.durationMs) : undefined,
        };
    }

    if (error && typeof error === 'object') {
        return {
            message: JSON.stringify(error),
        };
    }

    return {
        message: String(error || 'Unknown error'),
    };
};

export const pushClientDiagnostic = (type, payload = {}, severity = 'info') => {
    const timestamp = new Date().toISOString();
    const event = {
        id: createId('evt'),
        type,
        severity,
        timestamp,
        route: getCurrentRoute(),
        ...payload,
    };

    const now = Date.now();
    if (now - lastCounterReset > 60000) {
        eventCounter = 0;
        lastCounterReset = now;
    }

    if (eventCounter >= MAX_EVENTS_PER_MINUTE) {
        if (eventCounter === MAX_EVENTS_PER_MINUTE) {
            console.warn('[observability] Rate limit reached. Dropping further diagnostic events for this minute.');
        }
        eventCounter += 1;
        return event;
    }
    eventCounter += 1;

    const debugStore = getDebugStore();
    debugStore.events = [...(debugStore.events || []), event].slice(-MAX_BUFFERED_EVENTS);

    if (shouldPersistClientDiagnostic(event)) {
        debugStore.pendingDiagnostics = [
            ...(debugStore.pendingDiagnostics || []),
            sanitizeDiagnosticForTransport(event),
        ].slice(-MAX_PENDING_DIAGNOSTICS);
        scheduleDiagnosticsFlush();
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent(CLIENT_DIAGNOSTIC_EVENT, {
            detail: event,
        }));
    }

    if (import.meta.env.DEV) {
        const logMethod = severity === 'error'
            ? console.error
            : severity === 'warn'
                ? console.warn
                : console.info;
        logMethod('[observability]', type, event);
    }

    return event;
};

export const getBufferedClientDiagnostics = () => [...(getDebugStore().events || [])];

export const subscribeToClientDiagnostics = (listener) => {
    const windowRef = getWindowRef();
    if (!windowRef || typeof listener !== 'function') {
        return () => {};
    }

    const handleDiagnosticEvent = (event) => {
        listener(event?.detail || null);
    };

    windowRef.addEventListener(CLIENT_DIAGNOSTIC_EVENT, handleDiagnosticEvent);
    return () => {
        windowRef.removeEventListener(CLIENT_DIAGNOSTIC_EVENT, handleDiagnosticEvent);
    };
};

export const reportClientError = (error, context = {}) => pushClientDiagnostic(
    'client.runtime_error',
    {
        error: serializeError(error),
        context,
    },
    'error'
);

export const getErrorReference = (error) => String(
    error?.serverRequestId
    || error?.requestId
    || error?.data?.requestId
    || ''
);

const captureFetchFailure = ({
    stage,
    url,
    method,
    requestId,
    serverRequestId,
    status,
    durationMs,
    error,
}) => {
    if (isDiagnosticIngestUrl(url)) {
        return;
    }

    const severity = status >= 500 || status === 0 || stage === 'network_error' ? 'error' : 'warn';
    pushClientDiagnostic(
        `api.${stage}`,
        {
            url,
            method,
            requestId,
            serverRequestId,
            status,
            durationMs,
            error: error ? serializeError(error) : undefined,
        },
        severity
    );
};

export const initClientObservability = () => {
    const windowRef = getWindowRef();
    if (!windowRef) return;

    getClientSessionId();
    const debugStore = getDebugStore();

    if (!debugStore.originalFetch && typeof windowRef.fetch === 'function') {
        debugStore.originalFetch = windowRef.fetch.bind(windowRef);
    }

    if (!windowRef[FETCH_PATCH_FLAG] && typeof windowRef.fetch === 'function') {
        const originalFetch = getOriginalFetch() || windowRef.fetch.bind(windowRef);
        
        const auraFetch = async (input, init = undefined) => {
            const existingHeaders = init?.headers || (
                typeof Request !== 'undefined' && input instanceof Request
                    ? input.headers
                    : undefined
            );
            const trace = prepareTraceHeaders(input, existingHeaders);
            const method = String(
                init?.method
                || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
                || 'GET'
            ).toUpperCase();
            const startedAt = Date.now();

            if (!trace.traceable) {
                return originalFetch(input, init);
            }

            const nextInit = init ? { ...init, headers: trace.headers } : { headers: trace.headers };
            const nextInput = (typeof Request !== 'undefined' && input instanceof Request)
                ? new Request(input, { ...nextInit, headers: trace.headers })
                : input;

            try {
                const response = await originalFetch(nextInput, typeof Request !== 'undefined' && input instanceof Request ? undefined : nextInit);
                const durationMs = Date.now() - startedAt;
                const serverRequestId = response.headers.get('x-request-id') || trace.requestId;

                if (trace.traceable && !isDiagnosticIngestUrl(trace.url)) {
                    const shouldLogResponse = (
                        (response.status >= 400 && response.status !== 304)
                        || durationMs >= SLOW_REQUEST_THRESHOLD_MS
                    );
                    if (shouldLogResponse) {
                        captureFetchFailure({
                            stage: response.status >= 400 ? 'response_error' : 'slow_response',
                            url: trace.url,
                            method,
                            requestId: trace.requestId,
                            serverRequestId,
                            status: response.status,
                            durationMs,
                        });
                    }
                }

                return response;
            } catch (error) {
                if (trace.traceable) {
                    captureFetchFailure({
                        stage: 'network_error',
                        url: trace.url,
                        method,
                        requestId: trace.requestId,
                        serverRequestId: trace.requestId,
                        status: 0,
                        durationMs: Date.now() - startedAt,
                        error,
                    });
                }
                throw error;
            }
        };

        auraFetch[FETCH_PATCH_FLAG] = true;
        windowRef.fetch = auraFetch;
        windowRef[FETCH_PATCH_FLAG] = true;
    }

    if (!windowRef[LIFECYCLE_PATCH_FLAG]) {
        const handleOnline = () => {
            void flushBufferedClientDiagnostics({ force: true });
        };

        const handlePageHide = () => {
            void flushBufferedClientDiagnostics({ useBeacon: true, force: true });
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                void flushBufferedClientDiagnostics({ useBeacon: true, force: true });
                return;
            }

            if ((getDebugStore().pendingDiagnostics || []).length > 0) {
                void flushBufferedClientDiagnostics({ force: true });
            }
        };

        debugStore.lifecycleHandlers = {
            handleOnline,
            handlePageHide,
            handleVisibilityChange,
        };

        windowRef.addEventListener('online', handleOnline);
        windowRef.addEventListener('pagehide', handlePageHide);
        windowRef.addEventListener('visibilitychange', handleVisibilityChange);

        scheduleDiagnosticsFlush(DIAGNOSTIC_FLUSH_INTERVAL_MS);
        windowRef[LIFECYCLE_PATCH_FLAG] = true;
    }

    if (!windowRef[ERROR_PATCH_FLAG]) {
        const handleWindowError = (event) => {
            reportClientError(event.error || new Error(event.message || 'Unhandled window error'), {
                source: 'window.error',
                filename: event.filename || '',
                lineno: event.lineno || 0,
                colno: event.colno || 0,
            });
        };

        const handleUnhandledRejection = (event) => {
            const reason = event.reason instanceof Error
                ? event.reason
                : new Error(String(event.reason || 'Unhandled promise rejection'));

            reportClientError(reason, {
                source: 'window.unhandledrejection',
            });
        };

        debugStore.errorHandlers = {
            handleWindowError,
            handleUnhandledRejection,
        };

        windowRef.addEventListener('error', handleWindowError);
        windowRef.addEventListener('unhandledrejection', handleUnhandledRejection);

        windowRef[ERROR_PATCH_FLAG] = true;
    }
};

export const resetClientObservabilityForTests = () => {
    const windowRef = getWindowRef();
    if (!windowRef) return;

    const debugStore = getDebugStore();
    clearDiagnosticsFlushTimer();

    if (typeof debugStore.originalFetch === 'function') {
        windowRef.fetch = debugStore.originalFetch;
    }

    if (debugStore.lifecycleHandlers) {
        windowRef.removeEventListener('online', debugStore.lifecycleHandlers.handleOnline);
        windowRef.removeEventListener('pagehide', debugStore.lifecycleHandlers.handlePageHide);
        windowRef.removeEventListener('visibilitychange', debugStore.lifecycleHandlers.handleVisibilityChange);
    }

    if (debugStore.errorHandlers) {
        windowRef.removeEventListener('error', debugStore.errorHandlers.handleWindowError);
        windowRef.removeEventListener('unhandledrejection', debugStore.errorHandlers.handleUnhandledRejection);
    }

    delete windowRef[FETCH_PATCH_FLAG];
    delete windowRef[ERROR_PATCH_FLAG];
    delete windowRef[LIFECYCLE_PATCH_FLAG];
    delete windowRef[DEBUG_STORE_KEY];
};
