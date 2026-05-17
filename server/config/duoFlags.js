const trim = (value) => String(value || '').trim();

const parseBoolean = (value, fallback = false) => {
    const normalized = trim(value).toLowerCase();
    if (!normalized) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const normalizeDuoApiHost = (value) => trim(value).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
const stripTrailingSlash = (value) => trim(value).replace(/\/+$/, '');

const getDuoFlags = (env = process.env) => {
    const clientId = trim(env.DUO_CLIENT_ID);
    const clientSecret = trim(env.DUO_CLIENT_SECRET);
    const apiHost = normalizeDuoApiHost(env.DUO_API_HOST);
    const oidcIssuer = stripTrailingSlash(env.DUO_OIDC_ISSUER);
    const discoveryUrl = trim(env.DUO_DISCOVERY_URL) || (oidcIssuer ? `${oidcIssuer}/.well-known/openid-configuration` : '');
    const redirectUri = trim(env.DUO_REDIRECT_URI);
    const enabled = parseBoolean(env.DUO_ENABLED, false);
    const mode = oidcIssuer || discoveryUrl ? 'oidc' : 'web-sdk';

    return {
        enabled,
        failClosed: parseBoolean(env.DUO_FAIL_CLOSED, true),
        mode,
        clientId,
        clientSecret,
        apiHost,
        oidcIssuer,
        discoveryUrl,
        redirectUri,
        configured: mode === 'oidc'
            ? Boolean(clientId && clientSecret && oidcIssuer && discoveryUrl && redirectUri)
            : Boolean(clientId && clientSecret && apiHost && redirectUri),
    };
};

module.exports = {
    getDuoFlags,
    normalizeDuoApiHost,
    stripTrailingSlash,
};
