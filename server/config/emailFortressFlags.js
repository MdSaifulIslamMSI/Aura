const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseNumber = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
};

const parseCsv = (value, fallback = []) => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

const isTest = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'test';

const flags = {
    emailFortressEnabled: parseBoolean(process.env.EMAIL_FORTRESS_ENABLED, true),
    emailFortressStrictMode: parseBoolean(process.env.EMAIL_FORTRESS_STRICT_MODE, !isTest),
    emailFortressAllowedEventTypes: parseCsv(
        process.env.EMAIL_FORTRESS_ALLOWED_EVENT_TYPES,
        ['otp_security', 'order_placed', 'order_email_alert', 'user_activity', 'system']
    ),
    emailFortressAllowHtml: parseBoolean(process.env.EMAIL_FORTRESS_ALLOW_HTML, true),
    emailFortressMaxSubjectLen: parseNumber(process.env.EMAIL_FORTRESS_MAX_SUBJECT_LEN, 140, { min: 20, max: 300 }),
    emailFortressMaxTextLen: parseNumber(process.env.EMAIL_FORTRESS_MAX_TEXT_LEN, 20000, { min: 500, max: 150000 }),
    emailFortressMaxHtmlLen: parseNumber(process.env.EMAIL_FORTRESS_MAX_HTML_LEN, 250000, { min: 500, max: 1000000 }),
};

module.exports = {
    flags,
    parseBoolean,
    parseNumber,
    parseCsv,
};
