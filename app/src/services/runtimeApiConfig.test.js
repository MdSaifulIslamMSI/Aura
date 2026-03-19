import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiBaseUrl } from './runtimeApiConfig';

describe('runtimeApiConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers the configured API origin even on hosted frontend domains', () => {
    vi.stubEnv('VITE_API_URL', 'https://aura-msi-api-ca.wittycliff-f743de69.southeastasia.azurecontainerapps.io/api');

    expect(resolveApiBaseUrl('/api')).toBe('https://aura-msi-api-ca.wittycliff-f743de69.southeastasia.azurecontainerapps.io/api');
  });

  it('falls back to the local proxy path when no API origin is configured', () => {
    vi.stubEnv('VITE_API_URL', '');

    expect(resolveApiBaseUrl('/api')).toBe('/api');
  });
});
