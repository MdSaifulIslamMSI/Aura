const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseInteger = (value, fallback, { min = 1, max = 60 } = {}) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
};

const flags = {
    otpEmailFailClosed: parseBoolean(process.env.OTP_EMAIL_FAIL_CLOSED, true),
    otpEmailContextEnabled: parseBoolean(process.env.OTP_EMAIL_CONTEXT_ENABLED, true),
    otpEmailTtlMinutes: parseInteger(process.env.OTP_EMAIL_TTL_MINUTES, 5, { min: 1, max: 30 }),
    otpEmailSendInTest: parseBoolean(process.env.OTP_EMAIL_SEND_IN_TEST, false),
};

module.exports = {
    flags,
    parseBoolean,
    parseInteger,
};
