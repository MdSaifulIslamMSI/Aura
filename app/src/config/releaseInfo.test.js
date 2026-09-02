import { afterEach, describe, expect, it, vi } from 'vitest';
import releaseInfo, {
  formatReleaseBuiltAt,
  publishReleaseInfo,
  releaseInfo as namedReleaseInfo,
  resolveRuntimeHost,
} from './releaseInfo.js';

describe('releaseInfo', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes a frozen, fully sanitized release descriptor', () => {
    expect(releaseInfo).toBe(namedReleaseInfo);
    expect(Object.isFrozen(releaseInfo)).toBe(true);
    ['id', 'commitSha', 'shortCommitSha', 'deployTarget', 'channel', 'source'].forEach((field) => {
      expect(typeof releaseInfo[field]).toBe('string');
      expect(releaseInfo[field].length).toBeGreaterThan(0);
    });
    expect(['development', 'production']).toContain(releaseInfo.channel);
  });

  it('formats build timestamps with graceful fallbacks', () => {
    expect(formatReleaseBuiltAt('')).toBe('build time unavailable');
    expect(formatReleaseBuiltAt('not-a-timestamp')).toBe('not-a-timestamp');
    expect(formatReleaseBuiltAt('2026-03-01T12:00:00Z')).toMatch(/\d{4}/);
  });

  it('detects the runtime host from origins', () => {
    // Host detection matches the runtime origin against the configured
    // platform origins, so the test pins them instead of trusting ambient env.
    vi.stubEnv('VITE_VERCEL_FRONTEND_URL', 'https://aura.example.vercel.app');
    vi.stubEnv('VITE_NETLIFY_FRONTEND_URL', 'https://aura.example.netlify.app');

    expect(resolveRuntimeHost('https://aura.example.vercel.app')).toBe('vercel');
    expect(resolveRuntimeHost('https://aura.example.netlify.app')).toBe('netlify');
    expect(resolveRuntimeHost('http://localhost:5173')).toBe('local');
    expect(resolveRuntimeHost('https://aura.example.com')).toBe('aura.example.com');
    // An empty origin falls back to window.location.origin, which is jsdom's
    // localhost in tests — hence 'local', never 'unknown', in the browser.
    expect(resolveRuntimeHost('')).toBe('local');
  });

  it('publishes release metadata into the window and DOM', () => {
    vi.stubEnv('VITE_VERCEL_FRONTEND_URL', 'https://aura.example.vercel.app');
    vi.stubEnv('VITE_NETLIFY_FRONTEND_URL', 'https://aura.example.netlify.app');

    publishReleaseInfo();
    expect(window.__AURA_RELEASE__.id).toBe(releaseInfo.id);
    expect(window.__AURA_RELEASE__.runtimeOrigin).toContain('localhost');
    expect(window.__AURA_RELEASE__.runtimeHost).toBe('local');
    expect(document.documentElement.dataset.auraReleaseChannel).toBe(releaseInfo.channel);
    expect(document.querySelector('meta[name="aura-release-id"]').getAttribute('content'))
      .toBe(releaseInfo.id);
    expect(document.querySelector('meta[name="aura-runtime-host"]').getAttribute('content'))
      .toBe('local');
  });
});
