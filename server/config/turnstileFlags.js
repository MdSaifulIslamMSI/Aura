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

// Phase 5A: Turnstile previously degraded silently to "skipped: true" when
// the secret was missing, leaving OTP/auth endpoints with rate limits only
// and no alert. Production must now fail at startup instead; staging and
// development get a loud warning so the gap is visible without blocking.
const assertProductionTurnstileConfig = (env = process.env, log = console) => {
    const runtime = trim(env.NODE_ENV).toLowerCase();
    const flags = getTurnstileFlags(env);
    if (flags.enabled && flags.secretKey) return;
    if (runtime === 'production') {
        throw new Error('TURNSTILE_ENABLED with TURNSTILE_SECRET_KEY is required in production; OTP/auth bot checks would silently degrade to rate limits only.');
    }
    if (runtime === 'staging' || runtime === 'development') {
        log.warn('Turnstile bot checks are disabled in ' + runtime + '; OTP/auth endpoints rely on rate limits only.');
    }
};


module.exports = {
    getTurnstileFlags,
    assertProductionTurnstileConfig,
};
