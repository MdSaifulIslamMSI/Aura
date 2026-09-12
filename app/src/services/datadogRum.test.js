import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  datadogRumCdnUrl,
  resolveDatadogRumConfig,
  initDatadogRum,
  isDatadogRumEnabled,
  captureRumError,
  resetDatadogRumForTests,
} from './datadogRum';

describe('datadogRum config', () => {
  beforeEach(() => {
    resetDatadogRumForTests();
    delete window.DD_RUM;
  });

  afterEach(() => {
    resetDatadogRumForTests();
    delete window.DD_RUM;
    vi.restoreAllMocks();
  });

  it('stays disabled without an application id and client token (no script, no network)', async () => {
    expect(resolveDatadogRumConfig({ MODE: 'production' }).enabled).toBe(false);

    const state = await initDatadogRum({ applicationId: '', clientToken: '', configured: false, enabled: false });
    expect(state.enabled).toBe(false);
    expect(isDatadogRumEnabled()).toBe(false);
    expect(document.getElementById('aura-datadog-rum')).toBeNull();
  });

  it('stays disabled in test mode even with credentials', () => {
    const config = resolveDatadogRumConfig(
      { MODE: 'test', VITE_DD_APPLICATION_ID: 'app-id', VITE_DD_CLIENT_TOKEN: 'client-token' },
      { id: 'git-abc123', channel: 'test' },
    );
    expect(config.enabled).toBe(false);
    expect(config.configured).toBe(true);
  });

  it('resolves service, env, version, and cost-conscious sample rates', () => {
    const config = resolveDatadogRumConfig(
      { MODE: 'production', VITE_DD_APPLICATION_ID: 'app-id', VITE_DD_CLIENT_TOKEN: 'client-token' },
      { id: 'git-abc123', channel: 'production' },
    );
    expect(config).toMatchObject({
      enabled: true,
      service: 'aura-marketplace-frontend',
      env: 'production',
      version: 'git-abc123',
      sessionSampleRate: 10,
      sessionReplaySampleRate: 20,
    });
  });

  it('honors overrides and the kill switch', () => {
    const sampled = resolveDatadogRumConfig({
      MODE: 'production',
      VITE_DD_APPLICATION_ID: 'app-id',
      VITE_DD_CLIENT_TOKEN: 'client-token',
      VITE_DD_SESSION_SAMPLE_RATE: '50',
      VITE_DD_SITE: 'datadoghq.eu',
    });
    expect(sampled.sessionSampleRate).toBe(50);
    expect(sampled.site).toBe('datadoghq.eu');

    const killed = resolveDatadogRumConfig({
      MODE: 'production',
      VITE_DD_APPLICATION_ID: 'app-id',
      VITE_DD_CLIENT_TOKEN: 'client-token',
      VITE_DD_ENABLED: 'false',
    });
    expect(killed.enabled).toBe(false);
    expect(killed.sessionSampleRate).toBe(0);
  });

  it('maps Datadog sites to the correct CDN host', () => {
    expect(datadogRumCdnUrl('datadoghq.com')).toContain('/us1/v5/datadog-rum.js');
    expect(datadogRumCdnUrl('datadoghq.eu')).toContain('/eu1/v5/datadog-rum.js');
    expect(datadogRumCdnUrl('unknown-site.example')).toContain('/us1/v5/datadog-rum.js');
  });

  it('initializes RUM from the CDN bundle and forwards errors', async () => {
    const addError = vi.fn();
    const init = vi.fn();
    window.DD_RUM = { init, addError };

    const pending = initDatadogRum({
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
    });

    const script = document.getElementById('aura-datadog-rum');
    expect(script).not.toBeNull();
    expect(script.src).toContain('/us1/v5/datadog-rum.js');
    script.dispatchEvent(new Event('load'));

    const state = await pending;
    expect(state.enabled).toBe(true);
    expect(isDatadogRumEnabled()).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).toMatchObject({
      applicationId: 'app-id',
      defaultPrivacyLevel: 'mask',
    });

    captureRumError(new Error('boom'), { aura_route: '/cart' });
    expect(addError).toHaveBeenCalledTimes(1);
  });

  it('fails open when the CDN script cannot load', async () => {
    const pending = initDatadogRum({
      applicationId: 'app-id',
      clientToken: 'client-token',
      configured: true,
      enabled: true,
      site: 'datadoghq.com',
      service: 'svc',
      env: 'production',
      version: 'v',
      sessionSampleRate: 10,
      sessionReplaySampleRate: 20,
      trackUserInteractions: true,
    });

    const script = document.getElementById('aura-datadog-rum');
    expect(script).not.toBeNull();
    script.dispatchEvent(new Event('error'));

    const state = await pending;
    expect(state.enabled).toBe(false);
    expect(isDatadogRumEnabled()).toBe(false);
  });
});
