import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    isRuntimeTranslationEnabled,
    isStableUiRuntimeTranslationEnabled,
} from './runtimeTranslationPolicy';

describe('runtimeTranslationPolicy', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('keeps stable UI runtime translation disabled unless explicitly enabled', () => {
        vi.stubEnv('VITE_I18N_STABLE_UI_RUNTIME_TRANSLATION_ENABLED', '');
        expect(isStableUiRuntimeTranslationEnabled()).toBe(false);

        vi.stubEnv('VITE_I18N_STABLE_UI_RUNTIME_TRANSLATION_ENABLED', 'true');
        expect(isStableUiRuntimeTranslationEnabled()).toBe(true);
    });

    it('honors the dynamic runtime translation feature flag', () => {
        vi.stubEnv('VITE_I18N_RUNTIME_TRANSLATION_ENABLED', 'false');
        expect(isRuntimeTranslationEnabled()).toBe(false);

        vi.stubEnv('VITE_I18N_RUNTIME_TRANSLATION_ENABLED', 'true');
        expect(isRuntimeTranslationEnabled()).toBe(true);
    });
});
