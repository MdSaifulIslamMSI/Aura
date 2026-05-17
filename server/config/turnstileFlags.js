const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const trim = (value = '') => String(value || '').trim();

const getTurnstileFlags = (env = process.env) => {
    const secretKey = trim(env.TURNSTILE_SECRET_KEY);
    const siteKey = trim(env.TURNSTILE_SITE_KEY);
    const runtime = trim(env.NODE_ENV).toLowerCase();
    const enabled = parseBoolean(env.TURNSTILE_ENABLED, runtime === 'production' && Boolean(secretKey));

    return {
        enabled,
        failClosed: parseBoolean(env.TURNSTILE_FAIL_CLOSED, true),
        secretKey,
        siteKey,
        siteverifyUrl: trim(env.TURNSTILE_SITEVERIFY_URL) || 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        timeoutMs: Number(env.TURNSTILE_TIMEOUT_MS || 3000),
        testBypassToken: trim(env.TURNSTILE_TEST_BYPASS_TOKEN),
    };
};

module.exports = {
    getTurnstileFlags,
};
