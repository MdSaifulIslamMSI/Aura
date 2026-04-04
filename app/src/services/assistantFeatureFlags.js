import { getSafeEnv } from './runtimeApiConfig';

export const parseBooleanFlag = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

export const assistantFeatureFlags = Object.freeze({
    assistantV2Enabled: parseBooleanFlag(getSafeEnv('VITE_ASSISTANT_V2_ENABLED', 'true'), true),
});

export const isAssistantV2Enabled = () => assistantFeatureFlags.assistantV2Enabled;
