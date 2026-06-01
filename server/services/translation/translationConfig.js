const DEFAULT_LANGUAGE_CODE = 'en';

const SUPPORTED_TRANSLATION_LANGUAGES = new Set([
    'en',
    'bn',
    'hi',
    'te',
    'mr',
    'ur',
    'gu',
    'pa',
    'ml',
    'kn',
    'or',
    'as',
    'sa',
    'es',
    'fr',
    'de',
    'ar',
    'ja',
    'pt',
    'zh',
]);

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return fallback;
};

const parseIntegerEnv = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const numericValue = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.max(min, Math.min(numericValue, max));
};

const normalizeLanguage = (value = DEFAULT_LANGUAGE_CODE, fallback = DEFAULT_LANGUAGE_CODE) => {
    const normalized = String(value || '').trim().toLowerCase().split('-')[0];
    return SUPPORTED_TRANSLATION_LANGUAGES.has(normalized) ? normalized : fallback;
};

const normalizeSourceLanguage = (value = 'auto') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'auto') return 'auto';
    return normalizeLanguage(normalized, 'auto');
};

const normalizeProviderName = (value = 'noop') => {
    const normalized = String(value || 'noop').trim().toLowerCase();
    if (['noop', 'mock', 'libretranslate'].includes(normalized)) {
        return normalized;
    }
    return 'noop';
};

const getRuntimeTranslationConfig = () => {
    const requestedProvider = normalizeProviderName(process.env.I18N_TRANSLATION_PROVIDER || 'noop');
    const runtimeEnabledDefault = process.env.NODE_ENV !== 'production' && requestedProvider !== 'noop';
    const runtimeTranslationEnabled = parseBooleanEnv(
        process.env.I18N_RUNTIME_TRANSLATION_ENABLED,
        runtimeEnabledDefault
    );
    const providerName = runtimeTranslationEnabled ? requestedProvider : 'noop';

    return {
        cacheEnabled: parseBooleanEnv(process.env.I18N_TRANSLATION_CACHE_ENABLED, true),
        cacheTtlMs: parseIntegerEnv(process.env.I18N_TRANSLATION_CACHE_TTL_MS, 6 * 60 * 60 * 1000, {
            min: 60 * 1000,
            max: 24 * 60 * 60 * 1000,
        }),
        glossaryVersion: String(process.env.I18N_TRANSLATION_GLOSSARY_VERSION || 'v1'),
        libreTranslateBaseUrl: String(process.env.LIBRETRANSLATE_BASE_URL || 'http://localhost:5000').replace(/\/+$/, ''),
        maxBatchSize: parseIntegerEnv(process.env.I18N_TRANSLATION_MAX_BATCH_SIZE, 50, { min: 1, max: 50 }),
        maxTextLength: parseIntegerEnv(process.env.I18N_TRANSLATION_MAX_TEXT_LENGTH, 800, { min: 1, max: 800 }),
        providerName,
        providerTimeoutMs: parseIntegerEnv(process.env.I18N_TRANSLATION_PROVIDER_TIMEOUT_MS, 8000, {
            min: 500,
            max: 20000,
        }),
        requireAuthForHeavyUsage: parseBooleanEnv(
            process.env.I18N_TRANSLATION_REQUIRE_AUTH_FOR_HEAVY_USAGE,
            true
        ),
        runtimeTranslationEnabled,
    };
};

module.exports = {
    DEFAULT_LANGUAGE_CODE,
    SUPPORTED_TRANSLATION_LANGUAGES,
    getRuntimeTranslationConfig,
    normalizeLanguage,
    normalizeProviderName,
    normalizeSourceLanguage,
    parseBooleanEnv,
    parseIntegerEnv,
};
