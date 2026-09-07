import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRequestProofHeaders } from './requestProofSigner';

const stubCrypto = ({ uuid = 'test-uuid-1234', digestBytes = [0, 1, 2, 255] } = {}) => {
  const digest = vi.fn(async () => new Uint8Array(digestBytes).buffer);
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => uuid),
    subtle: { digest },
  });
  return { digest };
};

describe('requestProofSigner', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns empty headers when proof mode is disabled', async () => {
    vi.stubEnv('VITE_AUTH_SHIELD_DPOP_ENABLED', 'false');
    stubCrypto();
    await expect(buildRequestProofHeaders({ method: 'GET', url: '/api/cart' })).resolves.toEqual({});
  });

  it('returns empty headers when env flag is missing', async () => {
    vi.stubEnv('VITE_AUTH_SHIELD_DPOP_ENABLED', '');
    stubCrypto();
    await expect(buildRequestProofHeaders()).resolves.toEqual({});
  });

  it('builds shadow proof headers with nonce, timestamp and intent', async () => {
    vi.stubEnv('VITE_AUTH_SHIELD_DPOP_ENABLED', 'true');
    const { digest } = stubCrypto({ uuid: 'nonce-1' });
    const headers = await buildRequestProofHeaders({
      method: 'post',
      url: '/api/orders?debug=1',
      body: { total: 100 },
    });

    expect(headers['X-Aura-Request-Proof-Mode']).toBe('shadow');
    expect(headers['X-Aura-Nonce']).toBe('nonce-1');
    expect(headers['X-Aura-Proof-Intent']).toBe('POST /api/orders');
    expect(Number(headers['X-Aura-Timestamp'])).toBeGreaterThan(0);
    expect(typeof headers['X-Aura-Body-Hash']).toBe('string');
    expect(headers['X-Aura-Body-Hash']).toHaveLength(8);
    expect(digest).toHaveBeenCalledOnce();
  });

  it('emits empty body hash when no body is provided', async () => {
    vi.stubEnv('VITE_AUTH_SHIELD_DPOP_ENABLED', 'true');
    const { digest } = stubCrypto();
    const headers = await buildRequestProofHeaders({ method: 'GET', url: '/api/products' });

    expect(headers['X-Aura-Body-Hash']).toBe('');
    expect(digest).not.toHaveBeenCalled();
  });

  it('defaults method and url safely', async () => {
    vi.stubEnv('VITE_AUTH_SHIELD_DPOP_ENABLED', 'true');
    stubCrypto();
    const headers = await buildRequestProofHeaders();
    expect(headers['X-Aura-Proof-Intent']).toBe('GET ');
  });

  it('serializes object keys in stable order for hashing', async () => {
    vi.stubEnv('VITE_AUTH_SHIELD_DPOP_ENABLED', 'true');
    const seen = [];
    const digest = vi.fn(async (_alg, bytes) => {
      seen.push(new TextDecoder().decode(bytes));
      return new Uint8Array([1]).buffer;
    });
    vi.stubGlobal('crypto', { randomUUID: () => 'u', subtle: { digest } });

    await buildRequestProofHeaders({ method: 'GET', url: '/x', body: { b: 2, a: 1 } });
    expect(seen[0]).toBe('{"a":1,"b":2}');
  });
});
