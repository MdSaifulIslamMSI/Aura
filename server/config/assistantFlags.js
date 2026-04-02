const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parsePositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    if (numeric < min) return min;
    if (numeric > max) return max;
    return Math.floor(numeric);
};

const flags = {
    assistantV2Enabled: parseBoolean(process.env.ASSISTANT_V2_ENABLED, false),
    assistantV2SessionTtlSeconds: parsePositiveInt(process.env.ASSISTANT_V2_SESSION_TTL_SECONDS, 30 * 60, {
        min: 60,
        max: 24 * 60 * 60,
    }),
};

module.exports = {
    flags,
    parseBoolean,
};
