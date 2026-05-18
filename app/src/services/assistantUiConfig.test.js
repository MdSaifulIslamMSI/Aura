import {
    buildAssistantWorkspacePath,
    isDesktopAuthLoginRequest,
    isDesktopLoginPath,
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

    it('treats the workspace as dedicated chrome but not the launcher surface', () => {
        expect(shouldShowAmbientChrome('/assistant')).toBe(false);
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
        expect(shouldShowSiteChrome('/assistant')).toBe(false);
        expect(shouldShowSiteChrome('/products')).toBe(true);
    });

    it('treats desktop login as a dedicated auth surface', () => {
        expect(isDesktopLoginPath('/desktop-login')).toBe(true);
        expect(shouldShowSiteChrome('/desktop-login')).toBe(false);
        expect(shouldShowAmbientChrome('/desktop-login')).toBe(false);
        expect(shouldShowBackendStatusBanner('/desktop-login')).toBe(false);
    });

    it('recognizes legacy website login requests that belong to desktop auth', () => {
        expect(isDesktopAuthLoginRequest('/login', '?desktopAuthRequest=req-1')).toBe(true);
        expect(isDesktopAuthLoginRequest('/login', '?desktopAuthSecret=secret-1')).toBe(true);
        expect(isDesktopAuthLoginRequest('/login', '?desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete')).toBe(true);
        expect(isDesktopAuthLoginRequest('/login', '?next=/checkout')).toBe(false);
        expect(isDesktopAuthLoginRequest('/desktop-login', '?desktopAuthRequest=req-1')).toBe(false);
    });
});
