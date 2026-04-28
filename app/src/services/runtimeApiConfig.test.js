import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isHostedFrontendRuntimeHost,
  isLocalFrontendRuntimeHost,
  resolveApiBaseUrl,
  resolveServiceOrigin,
} from './runtimeApiConfig';

describe('runtimeApiConfig', () => {
  const originalLocation = window.location;

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('prefers the local proxy path on local frontend hosts when an absolute API origin is configured', () => {
    vi.stubEnv('VITE_API_URL', 'https://backend.example.com/api');
    vi.stubEnv('VITE_API_URL_ALLOW_REMOTE_LOCAL', 'false');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:5173',
        host: 'localhost:5173',
        hostname: 'localhost',
      },
    });

    expect(resolveApiBaseUrl('/api')).toBe('/api');
    expect(resolveServiceOrigin('/api')).toBe('http://localhost:5173');
  });

  it('allows local frontend hosts to keep the direct API origin when explicitly enabled', () => {
    vi.stubEnv('VITE_API_URL', 'https://backend.example.com/api');
    vi.stubEnv('VITE_API_URL_ALLOW_REMOTE_LOCAL', 'true');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:5173',
        host: 'localhost:5173',
        hostname: 'localhost',
      },
    });

    expect(resolveApiBaseUrl('/api')).toBe('https://backend.example.com/api');
    expect(resolveServiceOrigin('/api')).toBe('https://backend.example.com');
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

  it('prefers the hosted proxy path on CloudFront when a different direct API origin is configured', () => {
    vi.stubEnv('VITE_API_URL', 'https://13.206.172.186.sslip.io/api');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://dbtrhsolhec1s.cloudfront.net',
        host: 'dbtrhsolhec1s.cloudfront.net',
        hostname: 'dbtrhsolhec1s.cloudfront.net',
      },
    });

    expect(resolveApiBaseUrl('/api')).toBe('/api');
    expect(resolveServiceOrigin('/api')).toBe('https://dbtrhsolhec1s.cloudfront.net');
  });

  it('detects Vercel, Netlify, and CloudFront production hosts as hosted frontends', () => {
    expect(isHostedFrontendRuntimeHost('aurapilot.vercel.app')).toBe(true);
    expect(isHostedFrontendRuntimeHost('aurapilot.netlify.app')).toBe(true);
    expect(isHostedFrontendRuntimeHost('dbtrhsolhec1s.cloudfront.net')).toBe(true);
    expect(isHostedFrontendRuntimeHost('aurapilot.aws.app')).toBe(true);
    expect(isHostedFrontendRuntimeHost('localhost')).toBe(false);
  });

  it('detects local development hosts', () => {
    expect(isLocalFrontendRuntimeHost('localhost:5173')).toBe(true);
    expect(isLocalFrontendRuntimeHost('127.0.0.1:5173')).toBe(true);
    expect(isLocalFrontendRuntimeHost('aurapilot.vercel.app')).toBe(false);
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
