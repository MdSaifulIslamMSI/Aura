import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { resolveSentryConfig, initSentry, isSentryEnabled, resetSentryForTests } from './sentryClient';

describe('sentryClient config', () => {
  beforeEach(() => {
    resetSentryForTests();
  });

  afterEach(() => {
    resetSentryForTests();
  });

  it('stays disabled without a DSN (no SDK import, no network)', async () => {
    expect(resolveSentryConfig({ MODE: 'production' }).enabled).toBe(false);

    const state = await initSentry({ dsn: '', dsnConfigured: false, enabled: false });
    expect(state.enabled).toBe(false);
    expect(isSentryEnabled()).toBe(false);
  });

  it('stays disabled in test mode even with a DSN', () => {
    const config = resolveSentryConfig(
      { MODE: 'test', VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123' },
      { id: 'git-abc123', channel: 'test' }
    );
    expect(config.enabled).toBe(false);
    expect(config.dsnConfigured).toBe(true);
  });

  it('resolves release and environment from the app release info', () => {
    const config = resolveSentryConfig(
      { MODE: 'production', VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123' },
      { id: 'git-abc123', channel: 'production' }
    );
    expect(config).toMatchObject({
      enabled: true,
      release: 'git-abc123',
      environment: 'production',
      tracesSampleRate: 0.1,
      replaysOnErrorSampleRate: 1,
    });
  });

  it('honors sample-rate overrides and disables telemetry with the kill switch', () => {
    const sampled = resolveSentryConfig({
      MODE: 'production',
      VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
      VITE_SENTRY_TRACES_SAMPLE_RATE: '0.5',
      VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE: '0',
    });
    expect(sampled.tracesSampleRate).toBe(0.5);
    expect(sampled.replaysOnErrorSampleRate).toBe(0);

    const killed = resolveSentryConfig({
      MODE: 'production',
      VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
      VITE_SENTRY_ENABLED: 'false',
    });
    expect(killed).toMatchObject({
      enabled: false,
      tracesSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });
  });

  it('respects the VITE_SENTRY_ENABLED kill switch', () => {
    const config = resolveSentryConfig({
      MODE: 'production',
      VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
      VITE_SENTRY_ENABLED: 'false',
    });
    expect(config.enabled).toBe(false);
  });
});
