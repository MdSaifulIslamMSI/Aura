const isRequestProofEnabled = () => (
    String(import.meta.env?.VITE_AUTH_SHIELD_DPOP_ENABLED || '').trim().toLowerCase() === 'true'
);

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
