import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { MarketProvider } from '@/context/MarketContext';
import {
  normalizeDesktopAuthCallbackUrl,
  resolveDesktopBrowserHandoff,
  useLoginController,
} from './useLoginController';

const { getFirebaseSocialAuthStatusMock } = vi.hoisted(() => ({
  getFirebaseSocialAuthStatusMock: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({
  getFirebaseSocialAuthStatus: getFirebaseSocialAuthStatusMock,
}));

const LocationProbe = () => {
  const location = useLocation();
  return (
    <pre data-testid="location-probe">
      {JSON.stringify({
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        state: location.state || null,
      })}
    </pre>
  );
};

const LoginControllerProbe = () => {
  useLoginController();
  return <div>Login Screen</div>;
};

const SocialSignInProbe = () => {
  const { authError, handleSocialSignIn, signInWithGoogle } = useLoginController();
  const [result, setResult] = React.useState('idle');

  React.useEffect(() => {
    handleSocialSignIn(signInWithGoogle, 'Google')
      .then(() => setResult('completed'))
      .catch((error) => setResult(error?.message || 'failed'));
  }, [handleSocialSignIn, signInWithGoogle]);

  return (
    <>
      <div data-testid="social-result">{result}</div>
      <div data-testid="social-error-title">{authError?.title || 'none'}</div>
      <div data-testid="social-error-detail">{authError?.detail || 'none'}</div>
      <div data-testid="social-error-hint">{authError?.hint || 'none'}</div>
    </>
  );
};

const MicrosoftSignInProbe = () => {
  const { authError, handleSocialSignIn, signInWithMicrosoft } = useLoginController();
  const [result, setResult] = React.useState('idle');

  React.useEffect(() => {
    handleSocialSignIn(signInWithMicrosoft, 'Microsoft')
      .then(() => setResult('completed'))
      .catch((error) => setResult(error?.message || 'failed'));
  }, [handleSocialSignIn, signInWithMicrosoft]);

  return (
    <>
      <div data-testid="social-result">{result}</div>
      <div data-testid="social-error-title">{authError?.title || 'none'}</div>
      <div data-testid="social-error-detail">{authError?.detail || 'none'}</div>
      <div data-testid="social-error-hint">{authError?.hint || 'none'}</div>
    </>
  );
};

const DesktopBrowserSignInProbe = () => {
  const { authSuccess, canUseDesktopBrowserSignIn, handleDesktopBrowserSignIn } = useLoginController();
  const [result, setResult] = React.useState('idle');
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    handleDesktopBrowserSignIn()
      .then(() => setResult('completed'))
      .catch((error) => setResult(error?.message || 'failed'));
  }, [handleDesktopBrowserSignIn]);

  return (
    <>
      <div data-testid="desktop-browser-supported">{String(canUseDesktopBrowserSignIn)}</div>
      <div data-testid="desktop-browser-result">{result}</div>
      <div data-testid="desktop-browser-success-title">{authSuccess?.title || 'none'}</div>
    </>
  );
};

const DuoLoginFlagProbe = () => {
  const { isDuoLoginEnabled } = useLoginController();
  return <div data-testid="duo-login-enabled">{String(isDuoLoginEnabled)}</div>;
};

const PhoneCountryProbe = () => {
  const {
    formData,
    handlePhoneChange,
    handlePhoneCountryChange,
    phoneCountryCode,
    phoneLocalValue,
  } = useLoginController();

  return (
    <>
      <select aria-label="Country calling code" value={phoneCountryCode} onChange={handlePhoneCountryChange}>
        <option value="IN">India</option>
        <option value="GB">United Kingdom</option>
        <option value="US">United States</option>
      </select>
      <input aria-label="Phone Number" value={phoneLocalValue} onChange={handlePhoneChange} />
      <div data-testid="phone-country">{phoneCountryCode}</div>
      <div data-testid="phone-local">{phoneLocalValue}</div>
      <div data-testid="phone-full">{formData.phone}</div>
    </>
  );
};

const SecureSignalsProbe = () => {
  const { secureSignals } = useLoginController();
  const socialSignal = secureSignals.find((signal) => signal.label === 'Social access');
  return <div data-testid="social-access-signal">{socialSignal?.value || ''}</div>;
};

const buildAuthValue = (overrides = {}) => ({
  currentUser: null,
  isAuthenticated: false,
  loading: false,
  login: vi.fn(),
  loginWithPhoneCredential: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  signInWithFacebook: vi.fn(),
  signInWithGitHub: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithMicrosoft: vi.fn(),
  signInWithApple: vi.fn(),
  signInWithX: vi.fn(),
  signInWithDesktopBrowser: vi.fn(),
  signup: vi.fn(),
  syncUserWithBackend: vi.fn(),
  ...overrides,
});

const renderLoginController = (authValue, initialEntry) => render(
  <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
    <AuthContext.Provider value={buildAuthValue(authValue)}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Routes>
          <Route path="/login" element={<LoginControllerProbe />} />
          <Route path="/checkout" element={<div>Checkout Screen</div>} />
          <Route path="/profile" element={<div>Profile Screen</div>} />
          <Route path="/" element={<div>Home Screen</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  </MarketProvider>
);

describe('useLoginController', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: true,
      supported: true,
      runtimeHost: 'localhost',
      runtimeBlocked: false,
      redirectPreferred: false,
      runtimeIpHost: false,
      disabledByConfig: false,
      initErrorCode: '',
      initErrorMessage: '',
      runtimeElectronDesktop: false,
    });
  });

  it('accepts only loopback desktop callback urls for hosted handoff', () => {
    expect(normalizeDesktopAuthCallbackUrl('http://localhost:47831/desktop-auth/complete?x=1#frag'))
      .toBe('http://localhost:47831/desktop-auth/complete');
    expect(normalizeDesktopAuthCallbackUrl('http://127.0.0.1:47831/desktop-auth/complete'))
      .toBe('http://127.0.0.1:47831/desktop-auth/complete');
    expect(normalizeDesktopAuthCallbackUrl('/desktop-auth/complete')).toBe('/desktop-auth/complete');
    expect(normalizeDesktopAuthCallbackUrl('')).toBe('');
    expect(normalizeDesktopAuthCallbackUrl('https://evil.example.test/desktop-auth/complete')).toBe('');
  });

  it('parses a desktop browser handoff with a local callback bridge', () => {
    const handoff = resolveDesktopBrowserHandoff(
      '?desktopAuthRequest=req-1&desktopAuthSecret=secret-1&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthReturnTo=%2Fcheckout'
    );

    expect(handoff.active).toBe(true);
    expect(handoff.callbackUrl).toBe('http://localhost:47831/desktop-auth/complete');
    expect(handoff.returnTo).toBe('/checkout');
  });

  it('redirects already-authenticated visitors only after bootstrap settles', async () => {
    const initialEntry = {
      pathname: '/login',
      state: {
        from: {
          pathname: '/checkout',
          search: '?coupon=save10',
          hash: '#summary',
        },
      },
    };

    const view = renderLoginController({
      currentUser: { uid: 'user-1', email: 'member@example.com' },
      isAuthenticated: true,
      loading: true,
    }, initialEntry);

    expect(screen.getByText('Login Screen')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');

    view.rerender(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({
          currentUser: { uid: 'user-1', email: 'member@example.com' },
          isAuthenticated: true,
          loading: false,
        })}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <LocationProbe />
            <Routes>
              <Route path="/login" element={<LoginControllerProbe />} />
              <Route path="/checkout" element={<div>Checkout Screen</div>} />
              <Route path="/profile" element={<div>Profile Screen</div>} />
              <Route path="/" element={<div>Home Screen</div>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Checkout Screen')).toBeInTheDocument();
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/checkout"');
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?coupon=save10"');
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"hash":"#summary"');
    });
  });

  it('does not auto-redirect when auth resolves after the login page has already settled', async () => {
    const initialEntry = {
      pathname: '/login',
      state: {
        from: {
          pathname: '/profile',
          search: '',
          hash: '',
        },
      },
    };

    const view = renderLoginController({
      currentUser: null,
      isAuthenticated: false,
      loading: false,
    }, initialEntry);

    expect(screen.getByText('Login Screen')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');

    view.rerender(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({
          currentUser: { uid: 'user-2', email: 'fresh@example.com' },
          isAuthenticated: false,
          loading: true,
        })}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <LocationProbe />
            <Routes>
              <Route path="/login" element={<LoginControllerProbe />} />
              <Route path="/checkout" element={<div>Checkout Screen</div>} />
              <Route path="/profile" element={<div>Profile Screen</div>} />
              <Route path="/" element={<div>Home Screen</div>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    view.rerender(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({
          currentUser: { uid: 'user-2', email: 'fresh@example.com' },
          isAuthenticated: true,
          loading: false,
        })}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <LocationProbe />
            <Routes>
              <Route path="/login" element={<LoginControllerProbe />} />
              <Route path="/checkout" element={<div>Checkout Screen</div>} />
              <Route path="/profile" element={<div>Profile Screen</div>} />
              <Route path="/" element={<div>Home Screen</div>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Login Screen')).toBeInTheDocument();
      expect(screen.queryByText('Profile Screen')).not.toBeInTheDocument();
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');
    });
  });

  it('keeps popup-close as a cancellation message on safe hosts', async () => {
    const signInWithGoogle = vi.fn().mockRejectedValue(Object.assign(
      new Error('Google sign-in was cancelled before completion.'),
      { code: 'auth/popup-closed-by-user' },
    ));

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithGoogle })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<SocialSignInProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('social-error-title')).toHaveTextContent('Sign-In Cancelled');
      expect(screen.getByTestId('social-error-detail')).toHaveTextContent('The social sign-in window was closed before completing.');
    });

    expect(signInWithGoogle).toHaveBeenCalled();
  });

  it('shows a recoverable session-sync message when social auth succeeds but backend sync returns a masked 500', async () => {
    const signInWithGoogle = vi.fn().mockRejectedValue(Object.assign(
      new Error('Something went wrong!'),
      {
        status: 500,
        url: '/api/auth/sync',
        serverRequestId: 'req-social-sync-2',
      },
    ));

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithGoogle })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<SocialSignInProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('social-error-title')).toHaveTextContent('Google Sign-In Needs Retry');
      expect(screen.getByTestId('social-error-detail')).toHaveTextContent('could not finish opening your marketplace session');
      expect(screen.getByTestId('social-error-hint')).toHaveTextContent('req-social-sync-2');
    });

    expect(signInWithGoogle).toHaveBeenCalled();
  });

  it('keeps Microsoft account collision copy provider-specific', async () => {
    const signInWithMicrosoft = vi.fn().mockRejectedValue(Object.assign(
      new Error('Firebase: Error (auth/account-exists-with-different-credential).'),
      {
        code: 'auth/account-exists-with-different-credential',
        customData: {
          email: 'user@example.com',
          _tokenResponse: {
            providerId: 'microsoft.com',
          },
        },
      },
    ));

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithMicrosoft })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<MicrosoftSignInProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('social-error-title')).toHaveTextContent('Microsoft Account Already Exists');
      expect(screen.getByTestId('social-error-detail')).toHaveTextContent('user@example.com');
      expect(screen.getByTestId('social-error-hint')).toHaveTextContent('link Microsoft after login');
    });

    expect(signInWithMicrosoft).toHaveBeenCalled();
  });

  it('lets risky hosts complete the redirect handoff without surfacing a popup cancellation', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: true,
      supported: true,
      runtimeHost: '127.0.0.1',
      runtimeBlocked: false,
      redirectPreferred: true,
      runtimeIpHost: true,
      disabledByConfig: false,
      initErrorCode: '',
      initErrorMessage: '',
    });

    const signInWithGoogle = vi.fn().mockResolvedValue({ redirecting: true });

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithGoogle })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<SocialSignInProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('social-result')).toHaveTextContent('completed');
      expect(screen.getByTestId('social-error-title')).toHaveTextContent('none');
    });

    expect(signInWithGoogle).toHaveBeenCalled();
  });

  it('starts desktop browser sign-in only in the Electron runtime', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: true,
      supported: true,
      runtimeHost: 'localhost',
      runtimeBlocked: false,
      redirectPreferred: false,
      runtimeIpHost: false,
      disabledByConfig: false,
      initErrorCode: '',
      initErrorMessage: '',
      runtimeElectronDesktop: true,
    });

    const signInWithDesktopBrowser = vi.fn().mockResolvedValue({
      dbUser: { email: 'desktop@example.com' },
    });

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithDesktopBrowser })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<DesktopBrowserSignInProbe />} />
              <Route path="/" element={<div>Home Screen</div>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('desktop-browser-supported')).toHaveTextContent('true');
      expect(screen.getByTestId('desktop-browser-result')).toHaveTextContent('completed');
    });

    expect(signInWithDesktopBrowser).toHaveBeenCalledWith({ returnTo: '/' });
  });

  it('keeps Duo login hidden unless the deployment explicitly enables it', () => {
    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<DuoLoginFlagProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    expect(screen.getByTestId('duo-login-enabled')).toHaveTextContent('false');
  });

  it('summarizes only enabled expanded social providers', () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: true,
      supported: true,
      runtimeHost: 'dbtrhsolhec1s.cloudfront.net',
      runtimeBlocked: false,
      redirectPreferred: false,
      runtimeIpHost: false,
      disabledByConfig: false,
      microsoftEnabled: true,
      appleEnabled: false,
      initErrorCode: '',
      initErrorMessage: '',
    });

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<SecureSignalsProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    expect(screen.getByTestId('social-access-signal')).toHaveTextContent('Google, Facebook, GitHub, X, and Microsoft ready');
    expect(screen.getByTestId('social-access-signal')).not.toHaveTextContent('Apple');
  });

  it('keeps phone input international while letting users pick a country code', async () => {
    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<PhoneCountryProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    expect(screen.getByTestId('phone-country')).toHaveTextContent('IN');

    fireEvent.change(screen.getByLabelText('Country calling code'), { target: { value: 'GB' } });
    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '7911 123456' } });

    expect(screen.getByTestId('phone-country')).toHaveTextContent('GB');
    expect(screen.getByTestId('phone-local')).toHaveTextContent('7911123456');
    expect(screen.getByTestId('phone-full')).toHaveTextContent('+447911123456');

    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+1 202 555 0142' } });

    await waitFor(() => {
      expect(screen.getByTestId('phone-country')).toHaveTextContent('US');
      expect(screen.getByTestId('phone-local')).toHaveTextContent('2025550142');
      expect(screen.getByTestId('phone-full')).toHaveTextContent('+12025550142');
    });
  });
});
