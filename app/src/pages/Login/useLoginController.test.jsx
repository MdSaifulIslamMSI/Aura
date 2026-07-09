import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { MarketProvider } from '@/context/MarketContext';
import { authApi, otpApi } from '@/services/api';
import {
  buildDesktopDuoReturnTo,
  normalizeDesktopAuthCallbackUrl,
  persistDesktopBrowserHandoff,
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

const DuoLoginStartProbe = () => {
  const { handleDuoSignIn } = useLoginController();
  const [result, setResult] = React.useState('idle');
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    handleDuoSignIn()
      .then(() => setResult('completed'))
      .catch((error) => setResult(error?.message || 'failed'));
  }, [handleDuoSignIn]);

  return <div data-testid="duo-start-result">{result}</div>;
};

const DuoLoginStartWithEmailProbe = () => {
  const { formData, handleChange, handleDuoSignIn } = useLoginController();
  const [result, setResult] = React.useState('idle');

  return (
    <>
      <input aria-label="Email" name="email" value={formData.email} onChange={handleChange} />
      <button
        type="button"
        onClick={() => {
          handleDuoSignIn()
            .then(() => setResult('completed'))
            .catch((error) => setResult(error?.message || 'failed'));
        }}
      >
        start duo
      </button>
      <div data-testid="duo-start-result">{result}</div>
    </>
  );
};

const ResetPasswordFailureProbe = () => {
  const {
    authError,
    formData,
    handleChange,
    handleOtpChange,
    handlePhoneChange,
    handleSubmit,
    mode,
    otpValues,
    step,
    switchMode,
  } = useLoginController();

  return (
    <form onSubmit={handleSubmit}>
      <div data-testid="reset-mode">{mode}</div>
      <div data-testid="reset-step">{step}</div>
      <div data-testid="reset-error-title">{authError?.title || 'none'}</div>
      <div data-testid="reset-error-hint">{authError?.hint || 'none'}</div>
      <button type="button" onClick={() => switchMode('forgot-password')}>forgot</button>
      <input aria-label="Email" name="email" value={formData.email} onChange={handleChange} />
      <input aria-label="Phone Number" value={formData.phone} onChange={handlePhoneChange} />
      <input aria-label="Password" name="password" value={formData.password} onChange={handleChange} />
      <input aria-label="Confirm Password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} />
      {otpValues.map((value, index) => (
        <input
          aria-label={`OTP digit ${index + 1}`}
          key={index}
          value={value}
          onChange={(event) => handleOtpChange(index, event.target.value)}
        />
      ))}
      <button type="submit">submit</button>
      <button
        type="button"
        onClick={() => {
          const event = { preventDefault: vi.fn() };
          handleSubmit(event);
          handleSubmit(event);
        }}
      >
        double-submit
      </button>
    </form>
  );
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
    expect(normalizeDesktopAuthCallbackUrl('https://localhost:47831/desktop-auth/complete')).toBe('');
    expect(normalizeDesktopAuthCallbackUrl('http://localhost:49999/desktop-auth/complete')).toBe('');
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

  it('restores a Duo desktop handoff after the provider returns with only the request id', () => {
    expect(persistDesktopBrowserHandoff({
      requestId: 'req-restore-1',
      secret: 'secret-restore-1',
      callbackUrl: 'http://localhost:47831/desktop-auth/complete',
      returnTo: '/checkout',
    })).toBe(true);

    const handoff = resolveDesktopBrowserHandoff('?desktopAuthRequest=req-restore-1&duo=success');

    expect(handoff.active).toBe(true);
    expect(handoff.secret).toBe('secret-restore-1');
    expect(handoff.callbackUrl).toBe('http://localhost:47831/desktop-auth/complete');
    expect(handoff.returnTo).toBe('/checkout');
  });

  it('rejects prototype-sensitive desktop handoff request ids', () => {
    expect(persistDesktopBrowserHandoff({
      requestId: '__proto__',
      secret: 'secret-prototype',
      callbackUrl: 'http://localhost:47831/desktop-auth/complete',
    })).toBe(false);

    expect(resolveDesktopBrowserHandoff('?desktopAuthRequest=__proto__&duo=success').active).toBe(false);
    expect({}.secret).toBeUndefined();
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

  it('starts Duo desktop sign-in with a WAF-safe return URL and stores the loopback bridge locally', async () => {
    const startDuoLogin = vi.spyOn(authApi, 'startDuoLogin').mockReturnValue({
      redirecting: true,
      url: '/api/auth/duo/start',
    });
    const desktopLoginUrl = '/desktop-login?desktopAuthRequest=req-1&desktopAuthSecret=secret-1&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthReturnTo=%2Fcheckout#bridge';

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter initialEntries={[desktopLoginUrl]}>
            <Routes>
              <Route path="/desktop-login" element={<DuoLoginStartProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('duo-start-result')).toHaveTextContent('completed');
    });

    const expectedReturnTo = buildDesktopDuoReturnTo('req-1');
    expect(startDuoLogin).toHaveBeenCalledWith({
      returnTo: expectedReturnTo,
      loginHint: '',
    });
    expect(expectedReturnTo).toBe('/desktop-login?desktopAuthRequest=req-1');
    expect(expectedReturnTo).not.toContain('desktopAuthSecret');
    expect(expectedReturnTo).not.toContain('desktopAuthCallback');
    expect(expectedReturnTo).not.toContain('localhost');

    const restored = resolveDesktopBrowserHandoff('?desktopAuthRequest=req-1&duo=success');
    expect(restored.active).toBe(true);
    expect(restored.secret).toBe('secret-1');
    expect(restored.callbackUrl).toBe('http://localhost:47831/desktop-auth/complete');
    expect(restored.returnTo).toBe('/checkout');

    startDuoLogin.mockRestore();
  });

  it('does not send the app email field as the Duo login hint', async () => {
    const startDuoLogin = vi.spyOn(authApi, 'startDuoLogin').mockReturnValue({
      redirecting: true,
      url: '/api/auth/duo/start',
    });

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<DuoLoginStartWithEmailProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { name: 'email', value: 'app.user@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'start duo' }));

    await waitFor(() => {
      expect(screen.getByTestId('duo-start-result')).toHaveTextContent('completed');
    });

    expect(startDuoLogin).toHaveBeenCalledWith({
      returnTo: '/',
      loginHint: '',
    });

    startDuoLogin.mockRestore();
  });

  it('returns consumed reset grants to the recovery form instead of replaying the dead token', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: false,
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
    const sendOtp = vi.spyOn(otpApi, 'sendOtp').mockResolvedValue({ success: true });
    const verifyOtp = vi.spyOn(otpApi, 'verifyOtp').mockResolvedValue({
      success: true,
      flowToken: 'flow-reset-1',
    });
    const resetPassword = vi.spyOn(otpApi, 'resetPassword').mockRejectedValue(Object.assign(
      new Error('Login assurance token already used. Please verify OTP again.'),
      {
        status: 409,
        data: { message: 'Login assurance token already used. Please verify OTP again.' },
      },
    ));

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue()}>
            <MemoryRouter initialEntries={['/login']}>
              <Routes>
                <Route path="/login" element={<ResetPasswordFailureProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'forgot' }));
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+91 99999 99999' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(sendOtp).toHaveBeenCalledWith('user@example.com', '+919999999999', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('otp');
      });

      '123456'.split('').forEach((digit, index) => {
        fireEvent.change(screen.getByLabelText(`OTP digit ${index + 1}`), { target: { value: digit } });
      });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(verifyOtp).toHaveBeenCalledWith('+919999999999', '123456', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('reset-password');
      });

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(resetPassword).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('reset-step')).toHaveTextContent('form');
        expect(screen.getByTestId('reset-error-title')).toHaveTextContent('Recovery Session Expired');
        expect(screen.getByTestId('reset-error-hint')).toHaveTextContent('Request a fresh OTP');
      });

      fireEvent.click(screen.getByRole('button', { name: 'submit' }));
      expect(resetPassword).toHaveBeenCalledTimes(1);
    } finally {
      sendOtp.mockRestore();
      verifyOtp.mockRestore();
      resetPassword.mockRestore();
    }
  });

  it('returns rate-limited reset attempts to the recovery form instead of replaying the throttled token', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: false,
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
    const sendOtp = vi.spyOn(otpApi, 'sendOtp').mockResolvedValue({ success: true });
    const verifyOtp = vi.spyOn(otpApi, 'verifyOtp').mockResolvedValue({
      success: true,
      flowToken: 'flow-reset-rate-limited',
    });
    const resetPassword = vi.spyOn(otpApi, 'resetPassword').mockRejectedValue(Object.assign(
      new Error('Too many password reset attempts. Please wait before trying again.'),
      {
        status: 429,
        data: { message: 'Too many password reset attempts. Please wait before trying again.' },
      },
    ));

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue()}>
            <MemoryRouter initialEntries={['/login']}>
              <Routes>
                <Route path="/login" element={<ResetPasswordFailureProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'forgot' }));
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+91 99999 99999' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(sendOtp).toHaveBeenCalledWith('user@example.com', '+919999999999', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('otp');
      });

      '123456'.split('').forEach((digit, index) => {
        fireEvent.change(screen.getByLabelText(`OTP digit ${index + 1}`), { target: { value: digit } });
      });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(verifyOtp).toHaveBeenCalledWith('+919999999999', '123456', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('reset-password');
      });

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(resetPassword).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('reset-step')).toHaveTextContent('form');
        expect(screen.getByTestId('reset-error-title')).toHaveTextContent('Too Many Reset Attempts');
        expect(screen.getByTestId('reset-error-hint')).toHaveTextContent('Wait a few minutes');
      });

      fireEvent.click(screen.getByRole('button', { name: 'submit' }));
      expect(resetPassword).toHaveBeenCalledTimes(1);
    } finally {
      sendOtp.mockRestore();
      verifyOtp.mockRestore();
      resetPassword.mockRestore();
    }
  });

  it('returns server-side 503/500 failures to the recovery form to prevent token replay', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: false,
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
    const sendOtp = vi.spyOn(otpApi, 'sendOtp').mockResolvedValue({ success: true });
    const verifyOtp = vi.spyOn(otpApi, 'verifyOtp').mockResolvedValue({
      success: true,
      flowToken: 'flow-reset-503',
    });
    const resetPassword = vi.spyOn(otpApi, 'resetPassword').mockRejectedValue(Object.assign(
      new Error('Unable to update password right now. Please try again shortly.'),
      {
        status: 503,
        data: { message: 'Unable to update password right now. Please try again shortly.' },
      },
    ));

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue()}>
            <MemoryRouter initialEntries={['/login']}>
              <Routes>
                <Route path="/login" element={<ResetPasswordFailureProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'forgot' }));
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+91 99999 99999' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(sendOtp).toHaveBeenCalledWith('user@example.com', '+919999999999', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('otp');
      });

      '123456'.split('').forEach((digit, index) => {
        fireEvent.change(screen.getByLabelText(`OTP digit ${index + 1}`), { target: { value: digit } });
      });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(verifyOtp).toHaveBeenCalledWith('+919999999999', '123456', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('reset-password');
      });

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(resetPassword).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('reset-step')).toHaveTextContent('form');
      });

      fireEvent.click(screen.getByRole('button', { name: 'submit' }));
      expect(resetPassword).toHaveBeenCalledTimes(1);
    } finally {
      sendOtp.mockRestore();
      verifyOtp.mockRestore();
      resetPassword.mockRestore();
    }
  });

  it('ignores a second reset submit while the first request is still pending', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: false,
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
    const sendOtp = vi.spyOn(otpApi, 'sendOtp').mockResolvedValue({ success: true });
    const verifyOtp = vi.spyOn(otpApi, 'verifyOtp').mockResolvedValue({
      success: true,
      flowToken: 'flow-reset-pending',
    });
    let rejectResetPassword;
    const resetPassword = vi.spyOn(otpApi, 'resetPassword').mockImplementation(() => (
      new Promise((resolve, reject) => {
        rejectResetPassword = reject;
      })
    ));

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue()}>
            <MemoryRouter initialEntries={['/login']}>
              <Routes>
                <Route path="/login" element={<ResetPasswordFailureProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'forgot' }));
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+91 99999 99999' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(sendOtp).toHaveBeenCalledWith('user@example.com', '+919999999999', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('otp');
      });

      '123456'.split('').forEach((digit, index) => {
        fireEvent.change(screen.getByLabelText(`OTP digit ${index + 1}`), { target: { value: digit } });
      });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(verifyOtp).toHaveBeenCalledWith('+919999999999', '123456', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('reset-password');
      });

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.click(screen.getByRole('button', { name: 'double-submit' }));

      await waitFor(() => {
        expect(resetPassword).toHaveBeenCalledTimes(1);
      });

      rejectResetPassword(Object.assign(
        new Error('Unable to update password right now. Please try again shortly.'),
        { status: 503 }
      ));

      await waitFor(() => {
        expect(screen.getByTestId('reset-step')).toHaveTextContent('form');
      });
    } finally {
      sendOtp.mockRestore();
      verifyOtp.mockRestore();
      resetPassword.mockRestore();
    }
  });

  it('finishes a Duo desktop handoff from the backend session callback', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174000';
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken').mockResolvedValue({
      success: true,
      customToken: 'duo-desktop-custom-token',
    });
    const previousFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser: null,
            isAuthenticated: false,
            loading: false,
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}&desktopAuthSecret=secret-1&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthReturnTo=%2Fcheckout&duo=success#bridge`]}>
              <Routes>
                <Route path="/desktop-login" element={<LoginControllerProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(createToken).toHaveBeenCalledWith({
          firebaseUser: null,
          requestId,
        });
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:47831/desktop-auth/complete', expect.objectContaining({
          method: 'POST',
        }));
      });

      const [, requestOptions] = fetchMock.mock.calls[0];
      expect(JSON.parse(requestOptions.body)).toEqual({
        requestId,
        secret: 'secret-1',
        customToken: 'duo-desktop-custom-token',
      });
    } finally {
      createToken.mockRestore();
      vi.stubGlobal('fetch', previousFetch);
    }
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
