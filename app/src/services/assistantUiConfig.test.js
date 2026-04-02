import {
    buildAssistantWorkspacePath,
    isAssistantWorkspacePath,
    shouldShowAmbientChrome,
    shouldShowAssistantLauncher,
    shouldShowLegacyChatBot,
} from './assistantUiConfig';

describe('assistantUiConfig', () => {
    it('shows the assistant launcher only on supported shopping routes when v2 is enabled', () => {
        expect(shouldShowAssistantLauncher({
            pathname: '/product/101',
            assistantV2Enabled: true,
        })).toBe(true);
        expect(shouldShowAssistantLauncher({
            pathname: '/assistant',
            assistantV2Enabled: true,
        })).toBe(false);
        expect(shouldShowAssistantLauncher({
            pathname: '/admin/dashboard',
            assistantV2Enabled: true,
        })).toBe(false);
    });

    it('keeps legacy chatbot routing gated behind the v2 flag', () => {
        expect(shouldShowLegacyChatBot({
            pathname: '/cart',
            assistantV2Enabled: false,
        })).toBe(true);
        expect(shouldShowLegacyChatBot({
            pathname: '/cart',
            assistantV2Enabled: true,
        })).toBe(false);
    });

    it('builds the dedicated workspace path from the current route', () => {
        expect(buildAssistantWorkspacePath({
            pathname: '/product/101',
            search: '?ref=home',
        })).toBe('/assistant?from=%2Fproduct%2F101%3Fref%3Dhome');
    });

    it('treats the workspace as part of ambient chrome but not the launcher surface', () => {
        expect(shouldShowAmbientChrome('/assistant')).toBe(true);
        expect(isAssistantWorkspacePath('/assistant?from=%2F')).toBe(true);
    });
});
