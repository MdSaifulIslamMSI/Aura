import {
    buildAssistantWorkspacePath,
    isFrontendLaunchHubPath,
    isAssistantWorkspacePath,
    shouldShowAmbientChrome,
    shouldShowAssistantLauncher,
    shouldShowBackendStatusBanner,
    shouldShowSiteChrome,
} from './assistantUiConfig';

describe('assistantUiConfig', () => {
    it('shows the assistant launcher only on supported shopping routes', () => {
        expect(shouldShowAssistantLauncher({
            pathname: '/',
        })).toBe(false);
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

    it('limits the backend status banner to high-stakes surfaces', () => {
        expect(shouldShowBackendStatusBanner('/')).toBe(false);
        expect(shouldShowBackendStatusBanner('/products')).toBe(false);
        expect(shouldShowBackendStatusBanner('/checkout')).toBe(true);
        expect(shouldShowBackendStatusBanner('/admin/dashboard')).toBe(true);
    });

    it('hides persistent chrome on the launch hub route', () => {
        expect(isFrontendLaunchHubPath('/launch')).toBe(true);
        expect(shouldShowSiteChrome('/launch')).toBe(false);
        expect(shouldShowSiteChrome('/products')).toBe(true);
    });
});
