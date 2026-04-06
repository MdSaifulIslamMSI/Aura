import {
    buildAssistantWorkspacePath,
    isAssistantWorkspacePath,
    shouldShowAmbientChrome,
    shouldShowAssistantLauncher,
} from './assistantUiConfig';

describe('assistantUiConfig', () => {
    it('shows the assistant launcher only on supported shopping routes', () => {
        expect(shouldShowAssistantLauncher({
            pathname: '/product/101',
        })).toBe(true);
        expect(shouldShowAssistantLauncher({
            pathname: '/assistant',
        })).toBe(false);
        expect(shouldShowAssistantLauncher({
            pathname: '/admin/dashboard',
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
