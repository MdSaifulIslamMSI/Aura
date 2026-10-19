import { useCallback, useEffect, useState } from 'react';
import {
    TELEMETRY_CONSENT_DENIED,
    TELEMETRY_CONSENT_GRANTED,
    TELEMETRY_CONSENT_UNDECIDED,
    persistTelemetryConsent,
    resolveTelemetryConsent,
    subscribeToTelemetryConsent,
} from '@/services/telemetryConsent';

/**
 * Aura useTelemetryConsent
 * Reads the persisted third-party telemetry consent decision. The decision
 * defaults to "undecided", which every consumer treats as denied: no
 * session replay, no RUM, until the visitor explicitly opts in.
 */
export const useTelemetryConsent = () => {
    const [decision, setDecision] = useState(() => resolveTelemetryConsent());

    useEffect(() => subscribeToTelemetryConsent((nextDecision) => {
        setDecision(nextDecision);
    }), []);

    const grant = useCallback(() => (
        setDecision(persistTelemetryConsent(TELEMETRY_CONSENT_GRANTED))
    ), []);

    const deny = useCallback(() => (
        setDecision(persistTelemetryConsent(TELEMETRY_CONSENT_DENIED))
    ), []);

    return {
        decision,
        isGranted: decision === TELEMETRY_CONSENT_GRANTED,
        isUndecided: decision === TELEMETRY_CONSENT_UNDECIDED,
        grant,
        deny,
    };
};

export default useTelemetryConsent;
