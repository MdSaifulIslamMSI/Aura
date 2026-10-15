// Request-proof headers are emitted on every request: the server's Auth
// Shield replay guard enforces a fresh nonce and timestamp for critical
// actions, so these headers are required infrastructure, not an opt-in
// rollout flag. The remaining headers (mode, body hash, intent) prepare for
// DPoP sender binding per docs/adr/0005-dpop-rollout-sequence.md.
const isRequestProofEnabled = () => true;

const stableStringify = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const sha256Hex = async (value) => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
};

export const buildRequestProofHeaders = async ({
    method = 'GET',
    url = '',
    body = null,
} = {}) => {
    if (!isRequestProofEnabled()) {
        return {};
    }

    return {
        'X-Aura-Request-Proof-Mode': 'shadow',
        'X-Aura-Nonce': crypto.randomUUID(),
        'X-Aura-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Aura-Body-Hash': body ? await sha256Hex(stableStringify(body)) : '',
        'X-Aura-Proof-Intent': `${String(method || 'GET').toUpperCase()} ${String(url || '').split('?')[0]}`,
    };
};

export default buildRequestProofHeaders;
