// Consent gate for third-party session capture (Sentry session replay,
// Datadog RUM and its session replay).
//
// Both capture surfaces replay what the visitor does on the page, which is a
// third-country (US) transfer of session content. Until the visitor opts in,
// NOTHING is captured and nothing leaves the browser: the decision lives in
// localStorage so it survives a reload, and the default is "not decided",
// which every consumer must treat as "denied".

export const TELEMETRY_CONSENT_STORAGE_KEY = 'aura.telemetry.consent';
export const TELEMETRY_CONSENT_GRANTED = 'granted';
export const TELEMETRY_CONSENT_DENIED = 'denied';
export const TELEMETRY_CONSENT_UNDECIDED = 'undecided';

const consentListeners = new Set();

const getWindowRef = () => (typeof window !== 'undefined' ? window : null);

const normalizeDecision = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === TELEMETRY_CONSENT_GRANTED) return TELEMETRY_CONSENT_GRANTED;
    if (normalized === TELEMETRY_CONSENT_DENIED) return TELEMETRY_CONSENT_DENIED;
    return TELEMETRY_CONSENT_UNDECIDED;
};

const readStoredDecision = () => {
    const windowRef = getWindowRef();
    if (!windowRef) return TELEMETRY_CONSENT_UNDECIDED;

    try {
        return normalizeDecision(windowRef.localStorage?.getItem(TELEMETRY_CONSENT_STORAGE_KEY));
    } catch {
        // Storage can be unavailable (private mode, blocked cookies). Staying
        // undecided is safe because undecided behaves like denied.
        return TELEMETRY_CONSENT_UNDECIDED;
    }
};

const notifyConsentChange = (decision) => {
    consentListeners.forEach((listener) => {
        try {
            listener(decision);
        } catch {
            // A broken listener must never break the consent flow.
        }
    });
};

export const resolveTelemetryConsent = () => readStoredDecision();

export const isTelemetryConsentGranted = () => resolveTelemetryConsent() === TELEMETRY_CONSENT_GRANTED;

export const persistTelemetryConsent = (decision) => {
    const normalized = normalizeDecision(decision) === TELEMETRY_CONSENT_GRANTED
        ? TELEMETRY_CONSENT_GRANTED
        : TELEMETRY_CONSENT_DENIED;
    const windowRef = getWindowRef();

    try {
        windowRef?.localStorage?.setItem(TELEMETRY_CONSENT_STORAGE_KEY, normalized);
    } catch {
        // Storage unavailable: the returned decision still gates this page.
    }

    notifyConsentChange(normalized);
    return normalized;
};

export const subscribeToTelemetryConsent = (listener) => {
    if (typeof listener !== 'function') return () => {};

    consentListeners.add(listener);
    return () => {
        consentListeners.delete(listener);
    };
};

const windowRef = getWindowRef();
windowRef?.addEventListener?.('storage', (event) => {
    if (event?.key && event.key !== TELEMETRY_CONSENT_STORAGE_KEY) return;
    notifyConsentChange(readStoredDecision());
});
