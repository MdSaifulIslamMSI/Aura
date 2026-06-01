const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return fallback;
};

export const isRuntimeTranslationEnabled = () => parseBooleanEnv(
    import.meta.env.VITE_I18N_RUNTIME_TRANSLATION_ENABLED,
    !import.meta.env.PROD
);

export const isStableUiRuntimeTranslationEnabled = () => parseBooleanEnv(
    import.meta.env.VITE_I18N_STABLE_UI_RUNTIME_TRANSLATION_ENABLED,
    false
);
