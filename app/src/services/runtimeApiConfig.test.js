import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHostedFrontendRuntimeHost, resolveApiBaseUrl, resolveServiceOrigin } from './runtimeApiConfig';

describe('runtimeApiConfig', () => {
  const originalLocation = window.location;

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('prefers the configured API origin even on hosted frontend domains', () => {
    vi.stubEnv('VITE_API_URL', 'https://backend.example.com/api');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:5173',
        host: 'localhost:5173',
        hostname: 'localhost',
      },
    });

    expect(resolveApiBaseUrl('/api')).toBe('https://backend.example.com/api');
  });

  it('prefers the hosted proxy path on Vercel when a different direct API origin is configured', () => {
    vi.stubEnv('VITE_API_URL', 'https://backend.example.com/api');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://aurapilot.vercel.app',
        host: 'aurapilot.vercel.app',
        hostname: 'aurapilot.vercel.app',
      },
    });

    expect(resolveApiBaseUrl('/api')).toBe('/api');
    expect(resolveServiceOrigin('/api')).toBe('https://aurapilot.vercel.app');
  });

  it('prefers the hosted proxy path on Netlify when a different direct API origin is configured', () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:5000/api');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://aurapilot.netlify.app',
        host: 'aurapilot.netlify.app',
        hostname: 'aurapilot.netlify.app',
      },
    });

    expect(resolveApiBaseUrl('/api')).toBe('/api');
    expect(resolveServiceOrigin('/api')).toBe('https://aurapilot.netlify.app');
  });

  it('detects both Vercel and Netlify production hosts as hosted frontends', () => {
    expect(isHostedFrontendRuntimeHost('aurapilot.vercel.app')).toBe(true);
    expect(isHostedFrontendRuntimeHost('aurapilot.netlify.app')).toBe(true);
    expect(isHostedFrontendRuntimeHost('localhost')).toBe(false);
  });

  it('allows hosted frontends to keep the direct API origin when explicitly enabled', () => {
    vi.stubEnv('VITE_API_URL', 'https://backend.example.com/api');
    vi.stubEnv('VITE_API_URL_ALLOW_CROSS_ORIGIN_HOSTED', 'true');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://aurapilot.vercel.app',
        host: 'aurapilot.vercel.app',
        hostname: 'aurapilot.vercel.app',
      },
    });

    expect(resolveApiBaseUrl('/api')).toBe('https://backend.example.com/api');
    expect(resolveServiceOrigin('/api')).toBe('https://backend.example.com');
  });

  it('falls back to the local proxy path when no API origin is configured', () => {
    vi.stubEnv('VITE_API_URL', '');

    expect(resolveApiBaseUrl('/api')).toBe('/api');
  });
});
