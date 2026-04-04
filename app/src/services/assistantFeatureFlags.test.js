import { afterEach, describe, expect, it, vi } from 'vitest';

describe('assistantFeatureFlags', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('enables assistant v2 when the env flag is truthy', async () => {
        vi.stubEnv('VITE_ASSISTANT_V2_ENABLED', 'true');
        const { isAssistantV2Enabled } = await import('./assistantFeatureFlags');

        expect(isAssistantV2Enabled()).toBe(true);
    });

    it('falls back to enabled when the env flag is missing or invalid', async () => {
        vi.stubEnv('VITE_ASSISTANT_V2_ENABLED', 'maybe');
        const { isAssistantV2Enabled } = await import('./assistantFeatureFlags');

        expect(isAssistantV2Enabled()).toBe(true);
    });

    it('allows explicitly disabling the assistant surface', async () => {
        vi.stubEnv('VITE_ASSISTANT_V2_ENABLED', 'false');
        const { isAssistantV2Enabled } = await import('./assistantFeatureFlags');

        expect(isAssistantV2Enabled()).toBe(false);
    });

    it('parses common boolean flag values', async () => {
        const { parseBooleanFlag } = await import('./assistantFeatureFlags');

        expect(parseBooleanFlag('YES')).toBe(true);
        expect(parseBooleanFlag('off', true)).toBe(false);
        expect(parseBooleanFlag('', true)).toBe(true);
    });
});
