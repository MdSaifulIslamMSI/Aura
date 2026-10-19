import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentryMock = vi.hoisted(() => ({
    init: vi.fn(),
    close: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
    browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
    replayIntegration: vi.fn(() => ({ name: 'Replay' })),
}));

vi.mock('@sentry/react', () => sentryMock);

import { initSentry, resetSentryForTests, resolveSentryTelemetryConfig } from './sentryClient';
import { initDatadogRum, resetDatadogRumForTests } from './datadogRum';
import {
    TELEMETRY_CONSENT_DENIED,
    TELEMETRY_CONSENT_GRANTED,
    TELEMETRY_CONSENT_STORAGE_KEY,
    TELEMETRY_CONSENT_UNDECIDED,
    persistTelemetryConsent,
    resolveTelemetryConsent,
} from './telemetryConsent';

const SENTRY_OVERRIDES = {
    dsn: 'https://public@o4511422841421824.ingest.us.sentry.io/4511428819877888',
    dsnConfigured: true,
    enabled: true,
    replaysOnErrorSampleRate: 1,
};

const RUM_OVERRIDES = {
    applicationId: 'app-id',
    clientToken: 'client-token',
    configured: true,
    enabled: true,
    site: 'datadoghq.com',
    service: 'aura-marketplace-frontend',
    env: 'production',
    version: 'test-build',
    sessionSampleRate: 10,
    sessionReplaySampleRate: 20,
    trackUserInteractions: true,
};

describe('telemetry consent', () => {
    beforeEach(() => {
        window.localStorage.clear();
        resetSentryForTests();
        resetDatadogRumForTests();
        delete window.DD_RUM;
        sentryMock.init.mockClear();
        sentryMock.close.mockClear();
        sentryMock.replayIntegration.mockClear();
    });

    it('defaults to no decision, which every consumer must treat as denied', () => {
        expect(resolveTelemetryConsent()).toBe(TELEMETRY_CONSENT_UNDECIDED);
    });

    it('persists the decision under the documented storage key', () => {
        expect(persistTelemetryConsent(TELEMETRY_CONSENT_GRANTED)).toBe(TELEMETRY_CONSENT_GRANTED);
        expect(window.localStorage.getItem(TELEMETRY_CONSENT_STORAGE_KEY)).toBe(TELEMETRY_CONSENT_GRANTED);
        expect(resolveTelemetryConsent()).toBe(TELEMETRY_CONSENT_GRANTED);

        expect(persistTelemetryConsent(TELEMETRY_CONSENT_DENIED)).toBe(TELEMETRY_CONSENT_DENIED);
        expect(window.localStorage.getItem(TELEMETRY_CONSENT_STORAGE_KEY)).toBe(TELEMETRY_CONSENT_DENIED);
        expect(resolveTelemetryConsent()).toBe(TELEMETRY_CONSENT_DENIED);
    });

    it('keeps the Sentry replay off and the error reporting on without consent', async () => {
        const state = await initSentry(SENTRY_OVERRIDES);

        expect(state.enabled).toBe(true);
        expect(state.replayEnabled).toBe(false);
        expect(sentryMock.replayIntegration).not.toHaveBeenCalled();

        const initOptions = sentryMock.init.mock.calls[0][0];
        expect(initOptions.replaysOnErrorSampleRate).toBe(0);
        expect(initOptions.integrations).toHaveLength(1);
    });

    it('installs the masked Sentry replay only after an explicit opt-in', async () => {
        persistTelemetryConsent(TELEMETRY_CONSENT_GRANTED);

        const state = await initSentry(SENTRY_OVERRIDES);

        expect(state.enabled).toBe(true);
        expect(state.replayEnabled).toBe(true);
        expect(sentryMock.replayIntegration).toHaveBeenCalledWith({
            maskAllText: true,
            blockAllMedia: true,
        });

        const initOptions = sentryMock.init.mock.calls[0][0];
        expect(initOptions.replaysOnErrorSampleRate).toBe(1);
        expect(initOptions.integrations).toHaveLength(2);
    });

    it('never lets an override switch the replay gate back on', () => {
        const gated = resolveSentryTelemetryConfig(
            { MODE: 'production', VITE_SENTRY_DSN: 'https://public@example.ingest.us.sentry.io/1' },
            { id: 'git-abc123', channel: 'production' },
            TELEMETRY_CONSENT_UNDECIDED,
        );

        expect(gated.replayEnabled).toBe(false);
        expect(gated.replaysOnErrorSampleRate).toBe(0);
    });

    it('keeps the Datadog RUM bundle out of the page without consent', async () => {
        const state = await initDatadogRum(RUM_OVERRIDES);

        expect(state.enabled).toBe(false);
        expect(state.telemetryEnabled).toBe(false);
        expect(document.getElementById('aura-datadog-rum')).toBeNull();
    });

    it('starts the masked Datadog RUM session only after an explicit opt-in', async () => {
        persistTelemetryConsent(TELEMETRY_CONSENT_GRANTED);
        const init = vi.fn();
        window.DD_RUM = { init, addError: vi.fn() };

        const pending = initDatadogRum(RUM_OVERRIDES);
        const script = document.getElementById('aura-datadog-rum');
        expect(script).not.toBeNull();
        script.dispatchEvent(new Event('load'));

        const state = await pending;
        expect(state.enabled).toBe(true);
        expect(state.telemetryEnabled).toBe(true);
        expect(init).toHaveBeenCalledTimes(1);
        expect(init.mock.calls[0][0]).toMatchObject({
            defaultPrivacyLevel: 'mask',
            sessionReplaySampleRate: 20,
        });
    });
});
